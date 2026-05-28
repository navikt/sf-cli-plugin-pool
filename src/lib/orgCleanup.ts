import { Logger, Org, SfError } from '@salesforce/core';
import { ScratchOrgInfoRow } from '../types/scratch-org-info.js';

const logger = Logger.childFromRoot('orgCleanup');

export async function deleteOrg(org: ScratchOrgInfoRow): Promise<void> {
  const signupUsername = org.SignupUsername?.trim();

  if (!signupUsername) {
    throw new SfError(`Cannot delete scratch org ${org.Id}: no SignupUsername available.`, 'OrgDeleteError');
  }

  logger.debug('Deleting scratch org', { orgId: org.Id, signupUsername });

  try {
    const scratchOrg = await Org.create({ aliasOrUsername: signupUsername });
    await scratchOrg.delete();
    logger.debug('Scratch org deleted', { orgId: org.Id, signupUsername });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to delete scratch org ${org.Id}. ${message}`, 'OrgDeleteError');
  }
}
