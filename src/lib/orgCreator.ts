import { Connection, Logger, Org, SfError, scratchOrgCreate as defaultScratchOrgCreate } from '@salesforce/core';
import { ScratchOrgCreateOptions, ScratchOrgCreateResult } from '@salesforce/core';
import { OrgCreateOutcome } from '../types/pool-prepare.js';

const logger = Logger.childFromRoot('orgCreator');

type ScratchOrgCreateFn = (options: ScratchOrgCreateOptions) => Promise<ScratchOrgCreateResult>;

export async function createScratchOrg(
  hubOrg: Org,
  definitionFilePath: string,
  expirationDays?: number,
  scratchOrgCreateFn: ScratchOrgCreateFn = defaultScratchOrgCreate
): Promise<OrgCreateOutcome> {
  logger.debug('Creating scratch org', { definitionFilePath, expirationDays });

  let result;
  try {
    result = await scratchOrgCreateFn({
      hubOrg,
      definitionfile: definitionFilePath,
      durationDays: expirationDays,
      tracksSource: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to create scratch org. ${message}`, 'ScratchOrgCreateError');
  }

  const username = result.scratchOrgInfo?.Username ?? result.username;
  const orgId = result.scratchOrgInfo?.Id;

  if (!username || !orgId) {
    throw new SfError('Scratch org creation succeeded but returned no username or org ID.', 'ScratchOrgCreateError');
  }

  logger.debug('Scratch org created', { orgId, username });
  return { orgId, username };
}

export async function tagScratchOrg(connection: Connection, orgId: string, tag: string, status: string): Promise<void> {
  logger.debug('Tagging scratch org', { orgId, tag, status });

  try {
    /* eslint-disable camelcase */
    await connection.sobject('ScratchOrgInfo').update({
      Id: orgId,
      Pool_tag__c: tag,
      Pool_allocation_status__c: status,
    });
    /* eslint-enable camelcase */
    logger.debug('Scratch org tagged', { orgId, tag, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to tag scratch org ${orgId}. ${message}`, 'ScratchOrgTagError');
  }
}
