import { Logger } from '@salesforce/core';
import { ScratchOrgInfoRow } from '../types/scratch-org-info.js';
import { PoolCleanOrgResult, PoolCleanResult } from '../types/pool-clean.js';
import { deleteOrg as defaultDeleteOrg } from './orgCleanup.js';

const logger = Logger.childFromRoot('poolClean');

export type CleanPoolDeps = {
  deleteOrg: (org: ScratchOrgInfoRow) => Promise<void>;
};

const defaultDeps: CleanPoolDeps = {
  deleteOrg: defaultDeleteOrg,
};

export async function cleanPoolOrgs(
  orgs: ScratchOrgInfoRow[],
  deps: CleanPoolDeps = defaultDeps,
  onProgress?: (message: string) => void
): Promise<PoolCleanResult> {
  const results: PoolCleanOrgResult[] = [];
  let deleted = 0;
  let failed = 0;

  /* eslint-disable no-await-in-loop */
  for (const org of orgs) {
    const poolTag = org.Pool_tag__c ?? 'undefined';
    const status = org.Pool_allocation_status__c;

    try {
      onProgress?.(`Deleting scratch org ${org.Id} (pool: ${poolTag}, status: ${status})...`);
      await deps.deleteOrg(org);
      logger.debug('Scratch org deleted', { orgId: org.Id, poolTag });
      onProgress?.(`Deleted scratch org ${org.Id}.`);
      deleted++;
      results.push({
        scratchOrgId: org.Id,
        poolTag,
        status,
        deletionResult: 'deleted',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to delete scratch org', { orgId: org.Id, error: message });
      onProgress?.(`Failed to delete scratch org ${org.Id}: ${message}`);
      failed++;
      results.push({
        scratchOrgId: org.Id,
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
