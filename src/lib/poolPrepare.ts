import * as fs from 'node:fs';
import { AuthInfo, Connection, Logger, Messages, Org, SfError } from '@salesforce/core';
import { PoolConfig, PoolDefinition } from '../types/pool-config.js';
import { PackageDependency, PackageKeys } from '../types/package.js';
import { PoolPrepareResult } from '../types/pool-prepare.js';
import { queryPoolOrgs } from './poolQuery.js';
import { createScratchOrg, tagScratchOrg } from './orgCreator.js';
import { readSfdxProjectDependencies, installPackage } from './packageInstaller.js';
import { deleteOrg } from './orgCleanup.js';

const logger = Logger.childFromRoot('poolPrepare');
Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@navikt/sf-cli-plugin-pool', 'pool.prepare');

const STATUS_PROVISIONING = 'in_progress';
const STATUS_AVAILABLE = 'available';
const STATUS_FAILED = 'failed';

function validateConcurrency(value: unknown, tag: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SfError(messages.getMessage('error.invalid-concurrency', [tag]), 'PoolConcurrencyInvalidError');
  }
}

export function loadPoolConfig(filePath: string): PoolConfig {
  logger.debug('Loading pool config', { filePath });

  if (!fs.existsSync(filePath)) {
    throw new SfError(`Pool config file not found: ${filePath}`, 'PoolConfigNotFoundError');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to parse pool config file: ${filePath}. ${message}`, 'PoolConfigParseError');
  }

  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as Record<string, unknown>)['pools'])) {
    throw new SfError(
      `Invalid pool config: expected an object with a "pools" array at ${filePath}`,
      'PoolConfigInvalidError',
    );
  }

  const config = raw as PoolConfig;
  if (config.pools.length === 0) {
    throw new SfError(`Invalid pool config: "pools" array is empty at ${filePath}`, 'PoolConfigInvalidError');
  }

  for (const pool of config.pools) {
    if (pool.concurrency !== undefined) validateConcurrency(pool.concurrency, pool.tag);
  }

  return config;
}

export function loadPackageKeys(keysFilePath?: string): PackageKeys {
  const keys: PackageKeys = {};

  if (keysFilePath) {
    logger.debug('Loading package keys from file', { keysFilePath });
    if (!fs.existsSync(keysFilePath)) {
      throw new SfError(`Package keys file not found: ${keysFilePath}`, 'PackageKeysFileNotFoundError');
    }
    let fileKeys: unknown;
    try {
      fileKeys = JSON.parse(fs.readFileSync(keysFilePath, 'utf8'));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SfError(`Failed to parse package keys file: ${keysFilePath}. ${message}`, 'PackageKeysParseError');
    }
    if (typeof fileKeys === 'object' && fileKeys !== null) {
      for (const [alias, key] of Object.entries(fileKeys as Record<string, unknown>)) {
        if (typeof key !== 'string') {
          throw new SfError(
            `Invalid package keys file ${keysFilePath}: value for '${alias}' must be a string`,
            'PackageKeysInvalidError',
          );
        }
        keys[alias] = key;
      }
    }
  }

  return keys;
}

export function loadPackageKeysFromString(jsonString: string): PackageKeys {
  const keys: PackageKeys = {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to parse package keys JSON: ${message}`, 'PackageKeysParseError');
  }
  if (typeof parsed === 'object' && parsed !== null) {
    for (const [alias, key] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string') {
        throw new SfError(`Invalid package keys: value for '${alias}' must be a string`, 'PackageKeysInvalidError');
      }
      keys[alias] = key;
    }
  }

  return keys;
}

export async function resolveOrgsToCreate(connection: Connection, poolDef: PoolDefinition): Promise<number> {
  const existing = await queryPoolOrgs(connection, [poolDef.tag]);
  const gap = poolDef.count - existing.length;
  logger.debug('Resolved orgs to create', { tag: poolDef.tag, wanted: poolDef.count, existing: existing.length, gap });
  return Math.max(0, gap);
}

export type PreparePoolDeps = {
  createScratchOrg: typeof createScratchOrg;
  tagScratchOrg: typeof tagScratchOrg;
  deleteOrg: typeof deleteOrg;
  readSfdxProjectDependencies: (
    sfdxProjectFile: string,
    devHubConnection: Connection,
    packageKeys?: PackageKeys,
  ) => Promise<PackageDependency[]>;
  installPackage: typeof installPackage;
  getTargetOrgConnection: (username: string) => Promise<Connection>;
  getSfdxAuthUrl: (username: string) => Promise<string>;
};

const defaultDeps: PreparePoolDeps = {
  createScratchOrg,
  tagScratchOrg,
  deleteOrg,
  readSfdxProjectDependencies,
  installPackage,
  getTargetOrgConnection: async (username: string): Promise<Connection> => {
    const authInfo = await AuthInfo.create({ username });
    return Connection.create({ authInfo });
  },
  getSfdxAuthUrl: async (username: string): Promise<string> => {
    const authInfo = await AuthInfo.create({ username });
    return authInfo.getSfdxAuthUrl();
  },
};

export async function preparePool(
  hubOrg: Org,
  poolDef: PoolDefinition,
  packageKeys: PackageKeys,
  sfdxProjectFile: string,
  keepFailed: boolean,
  apiVersion?: string,
  deps: PreparePoolDeps = defaultDeps,
  onProgress?: (message: string) => void,
  concurrencyOverride?: number,
): Promise<PoolPrepareResult> {
  const concurrency = concurrencyOverride ?? poolDef.concurrency ?? 3;
  validateConcurrency(concurrency, poolDef.tag);
  const connection = hubOrg.getConnection(apiVersion);
  const existing = await queryPoolOrgs(connection, [poolDef.tag]);
  const gap = Math.max(0, poolDef.count - existing.length);

  const result: PoolPrepareResult = {
    tag: poolDef.tag,
    requested: poolDef.count,
    existing: existing.length,
    created: 0,
    failed: 0,
    skipped: gap === 0,
    errors: [],
  };

  if (gap === 0) {
    logger.debug('Pool already at capacity, skipping', { tag: poolDef.tag, count: poolDef.count });
    return result;
  }

  const dependencies = await deps.readSfdxProjectDependencies(sfdxProjectFile, connection, packageKeys);
  const maxRetries = poolDef.retryCount ?? 0;

  const prepareSlot = async (slot: number): Promise<Error | undefined> => {
    let lastError: Error | undefined;
    let orgId: string | undefined;
    let username: string | undefined;
    const progress = (key: string, values: string[]): void =>
      onProgress?.(messages.getMessage(key, [poolDef.tag, String(slot + 1), ...values]));

    /* eslint-disable no-await-in-loop */
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.debug('Creating org', { tag: poolDef.tag, slot: slot + 1, attempt: attempt + 1 });

        const created = await deps.createScratchOrg(hubOrg, poolDef.definitionFilePath, poolDef.expirationDays);
        orgId = created.orgId;
        username = created.username;
        logger.info('Scratch org created', { orgId, username: created.username, tag: poolDef.tag });
        progress('info.org-created', [created.username]);

        await deps.tagScratchOrg(connection, orgId, poolDef.tag, STATUS_PROVISIONING);

        const targetConnection = await deps.getTargetOrgConnection(created.username);
        for (const dep of dependencies) {
          logger.info('Installing package on scratch org', { alias: dep.alias, packageId: dep.packageId, orgId });
          progress('info.package-installing', [dep.alias, dep.packageId]);
          await deps.installPackage(targetConnection, dep.packageId, dep.alias, dep.installationKey);
          progress('info.package-installed', [dep.alias]);
        }

        const sfdxAuthUrl = await deps.getSfdxAuthUrl(created.username);
        await deps.tagScratchOrg(connection, orgId, poolDef.tag, STATUS_AVAILABLE, sfdxAuthUrl);

        return undefined;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn('Org creation/provisioning attempt failed', {
          tag: poolDef.tag,
          slot: slot + 1,
          attempt: attempt + 1,
          error: lastError.message,
        });
        progress('info.attempt-failed', [String(attempt + 1), lastError.message]);

        if (orgId) {
          if (!keepFailed) {
            try {
              /* eslint-disable camelcase */
              await deps.deleteOrg({
                Id: orgId,
                Pool_allocation_status__c: STATUS_FAILED,
                Pool_tag__c: poolDef.tag,
                SignupUsername: username,
              });
              /* eslint-enable camelcase */
            } catch (deleteError) {
              logger.debug('Failed to delete failed org', {
                orgId,
                error: deleteError instanceof Error ? deleteError.message : String(deleteError),
              });
            }
          } else {
            try {
              await deps.tagScratchOrg(connection, orgId, poolDef.tag, STATUS_FAILED);
            } catch (tagError) {
              logger.debug('Failed to mark org as failed', {
                orgId,
                error: tagError instanceof Error ? tagError.message : String(tagError),
              });
            }
          }
          orgId = undefined;
          username = undefined;
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return lastError;
  };

  const outcomes: Array<Error | undefined> = new Array<Error | undefined>(gap);
  let nextSlot = 0;
  const worker = async (): Promise<void> => {
    while (nextSlot < gap) {
      const slot = nextSlot++;
      // eslint-disable-next-line no-await-in-loop
      outcomes[slot] = await prepareSlot(slot);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, gap) }, worker));
  result.errors = outcomes.filter((error): error is Error => error !== undefined).map((error) => error.message);
  result.failed = result.errors.length;
  result.created = gap - result.failed;

  return result;
}
