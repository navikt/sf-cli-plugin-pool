import { Connection, Logger } from '@salesforce/core';

const logger = Logger.childFromRoot('poolDoctor');

export const FIELD_NAMES = [
  'Pool_tag__c',
  'Pool_allocation_status__c',
  'Sfdx_Auth_Url__c',
  'Pool_claim_token__c',
] as const;

export type PoolDoctorField = (typeof FIELD_NAMES)[number];

export type FieldCheckResult = 'pass' | 'fail';

/**
 * Checks whether a single ScratchOrgInfo custom field is readable by running a
 * SOQL probe query. Returns 'pass' when the query succeeds (or returns no rows)
 * and 'fail' when the org rejects the field (INVALID_FIELD / INVALID_TYPE).
 * Any other error is re-thrown.
 */
export async function checkFieldAccess(connection: Connection, fieldName: PoolDoctorField): Promise<FieldCheckResult> {
  const query = `SELECT Id FROM ScratchOrgInfo WHERE ${fieldName} != null LIMIT 1`;
  logger.debug(`Probing field access: ${fieldName}`);

  try {
    await connection.query<{ Id: string }>(query);
    logger.debug(`Field probe passed: ${fieldName}`);
    return 'pass';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/INVALID_FIELD|INVALID_TYPE/i.test(message)) {
      logger.debug(`Field probe failed (missing/inaccessible): ${fieldName} — ${message}`);
      return 'fail';
    }
    // Unexpected error — propagate so the hook can surface it as 'unknown'
    throw error;
  }
}
