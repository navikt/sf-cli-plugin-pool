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

export async function preparePool(
  hubOrg: Org,
  poolDef: PoolDefinition,
  packageKeys: PackageKeys,
  sfdxProjectPath: string,
  keepFailed: boolean
): Promise<PoolPrepareResult> {
  const connection = hubOrg.getConnection();
  const existing = await queryPoolOrgs(connection, [poolDef.tag]);
  const gap = Math.max(0, poolDef.count - existing.length);

  const result: PoolPrepareResult = {
    tag: poolDef.tag,
    requested: poolDef.count,
    existing: existing.length,
    created: 0,
    failed: 0,
    skipped: gap === 0,
  };

  if (gap === 0) {
    logger.debug('Pool already at capacity, skipping', { tag: poolDef.tag, count: poolDef.count });
    return result;
  }

  const dependencies = await readSfdxProjectDependencies(sfdxProjectPath, packageKeys);
  const maxRetries = poolDef.retryCount ?? 0;

  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < gap; i++) {
    let lastError: Error | undefined;
    let orgId: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        logger.debug('Creating org', { tag: poolDef.tag, slot: i + 1, attempt: attempt + 1 });

        const created = await createScratchOrg(hubOrg, poolDef.definitionFilePath, poolDef.expirationDays);
        orgId = created.orgId;

        await tagScratchOrg(connection, orgId, poolDef.tag, STATUS_PROVISIONING);

        for (const dep of dependencies) {
          const targetConnection = await getTargetOrgConnection(created.username);
          await installPackage(targetConnection, dep.packageId, dep.alias, dep.installationKey);
        }

        await tagScratchOrg(connection, orgId, poolDef.tag, STATUS_AVAILABLE);

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
      }
    }

    if (lastError) {
      result.failed++;
      if (orgId) {
        if (!keepFailed) {
          try {
            await deleteOrg(connection, orgId);
          } catch (deleteError) {
            logger.debug('Failed to delete failed org', {
              orgId,
              error: deleteError instanceof Error ? deleteError.message : String(deleteError),
            });
          }
        } else {
          try {
            await tagScratchOrg(connection, orgId, poolDef.tag, STATUS_FAILED);
          } catch (tagError) {
            logger.debug('Failed to mark org as failed', { orgId });
          }
        }
      }
    }
  }
  /* eslint-enable no-await-in-loop */

  return result;
}

async function getTargetOrgConnection(username: string): Promise<Connection> {
  const { AuthInfo, Connection: SfConnection } = await import('@salesforce/core');
  const authInfo = await AuthInfo.create({ username });
  return SfConnection.create({ authInfo });
}
