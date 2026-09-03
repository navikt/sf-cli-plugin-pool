import { Connection, Logger } from '@salesforce/core';
import { CleanableOrgRow } from '../types/scratch-org-info.js';
import { PoolCleanOrgResult, PoolCleanResult } from '../types/pool-clean.js';
import { deleteActiveScratchOrg as defaultDeleteOrg } from './orgCleanup.js';

const logger = Logger.childFromRoot('poolClean');

export type CleanPoolDeps = {
  deleteOrg: (connection: Connection, activeScratchOrgId: string) => Promise<void>;
};

const defaultDeps: CleanPoolDeps = {
  deleteOrg: defaultDeleteOrg,
};

export async function cleanPoolOrgs(
  connection: Connection,
  orgs: CleanableOrgRow[],
  deps: CleanPoolDeps = defaultDeps,
  onProgress?: (message: string) => void,
): Promise<PoolCleanResult> {
  const results: PoolCleanOrgResult[] = [];
  let deleted = 0;
  let failed = 0;

  /* eslint-disable no-await-in-loop */
  for (const org of orgs) {
    const scratchOrgInfo = org.ScratchOrgInfo;
    const poolTag = scratchOrgInfo.Pool_tag__c ?? 'undefined';
    const status = scratchOrgInfo.Pool_allocation_status__c;

    try {
      onProgress?.(`Deleting scratch org ${scratchOrgInfo.Id} (pool: ${poolTag}, status: ${status})...`);
      await deps.deleteOrg(connection, org.Id);
      logger.debug('Scratch org deleted', { orgId: scratchOrgInfo.Id, activeScratchOrgId: org.Id, poolTag });
      onProgress?.(`Deleted scratch org ${scratchOrgInfo.Id}.`);
      deleted++;
      results.push({
        scratchOrgId: scratchOrgInfo.Id,
        poolTag,
        status,
        deletionResult: 'deleted',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to delete scratch org', {
        orgId: scratchOrgInfo.Id,
        activeScratchOrgId: org.Id,
        error: message,
      });
      onProgress?.(`Failed to delete scratch org ${scratchOrgInfo.Id}: ${message}`);
      failed++;
      results.push({
        scratchOrgId: scratchOrgInfo.Id,
        poolTag,
        status,
        deletionResult: 'failed',
        error: message,
      });
    }
  }
  /* eslint-enable no-await-in-loop */

  return {
    orgs: results,
    summary: {
      deleted,
      failed,
      total: orgs.length,
    },
  };
}
