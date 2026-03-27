import { Connection, Logger, SfError } from '@salesforce/core';

const logger = Logger.childFromRoot('orgCleanup');

export async function deleteOrg(connection: Connection, orgId: string): Promise<void> {
  logger.debug('Deleting scratch org', { orgId });

  try {
    await connection.sobject('ActiveScratchOrg').delete(orgId);
    logger.debug('Scratch org deleted', { orgId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to delete scratch org ${orgId}. ${message}`, 'OrgDeleteError');
  }
}
