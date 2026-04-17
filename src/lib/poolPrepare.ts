import * as fs from 'node:fs';
import { Connection, Logger, Org, SfError } from '@salesforce/core';
import { PoolConfig, PoolDefinition } from '../types/pool-config.js';
import { PackageKeys, PoolPrepareResult } from '../types/pool-prepare.js';
import { queryPoolOrgs } from './poolQuery.js';
import { createScratchOrg, tagScratchOrg } from './orgCreator.js';
import { readSfdxProjectDependencies, installPackage } from './packageInstaller.js';
import { deleteOrg } from './orgCleanup.js';

const logger = Logger.childFromRoot('poolPrepare');

const STATUS_PROVISIONING = 'Provisioning';
const STATUS_AVAILABLE = 'Available';
const STATUS_FAILED = 'Failed';

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
      'PoolConfigInvalidError'
    );
  }

  return raw as PoolConfig;
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
        if (typeof key === 'string') {
          keys[alias] = key;
        }
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
      if (typeof key === 'string') {
        keys[alias] = key;
      }
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
  readSfdxProjectDependencies: typeof readSfdxProjectDependencies;
  installPackage: typeof installPackage;
  getTargetOrgConnection: (username: string) => Promise<Connection>;
};

const defaultDeps: PreparePoolDeps = {
  createScratchOrg,
  tagScratchOrg,
  deleteOrg,
  readSfdxProjectDependencies,
  installPackage,
  getTargetOrgConnection: async (username: string): Promise<Connection> => {
    const { AuthInfo, Connection: SfConnection } = await import('@salesforce/core');
    const authInfo = await AuthInfo.create({ username });
    return SfConnection.create({ authInfo });
  },
};

export async function preparePool(
  hubOrg: Org,
  poolDef: PoolDefinition,
  packageKeys: PackageKeys,
  sfdxProjectFile: string,
  keepFailed: boolean,
  apiVersion?: string,
  deps: PreparePoolDeps = defaultDeps
): Promise<PoolPrepareResult> {
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

  const dependencies = await deps.readSfdxProjectDependencies(sfdxProjectFile, packageKeys);
  const maxRetries = poolDef.retryCount ?? 0;

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < gap; i++) {
    let lastError: Error | undefined;
    let orgId: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.debug('Creating org', { tag: poolDef.tag, slot: i + 1, attempt: attempt + 1 });

        const created = await deps.createScratchOrg(hubOrg, poolDef.definitionFilePath, poolDef.expirationDays);
        orgId = created.orgId;

        await deps.tagScratchOrg(connection, orgId, poolDef.tag, STATUS_PROVISIONING);

        const targetConnection = await deps.getTargetOrgConnection(created.username);
        for (const dep of dependencies) {
          await deps.installPackage(targetConnection, dep.packageId, dep.alias, dep.installationKey);
        }

        await deps.tagScratchOrg(connection, orgId, poolDef.tag, STATUS_AVAILABLE);

        result.created++;
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug('Org creation attempt failed', {
          tag: poolDef.tag,
          slot: i + 1,
          attempt: attempt + 1,
          error: lastError.message,
        });

        if (orgId) {
          if (!keepFailed) {
            try {
              await deps.deleteOrg(connection, orgId);
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
              logger.debug('Failed to mark org as failed', { orgId });
            }
          }
          orgId = undefined;
        }
      }
    }

    if (lastError) {
      result.failed++;
      result.errors.push(lastError.message);
    }
  }
  /* eslint-enable no-await-in-loop */

  return result;
}
