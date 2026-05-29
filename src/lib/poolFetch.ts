import { AuthInfo, Connection, Logger, SfError } from '@salesforce/core';
import { ScratchOrgInfoRow } from '../types/scratch-org-info.js';
import { PoolFetchResult } from '../types/pool-fetch.js';

const logger = Logger.childFromRoot('poolFetch');

function escapeSOQL(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function queryOldestAvailableOrg(connection: Connection, tag: string): Promise<ScratchOrgInfoRow | null> {
  const sanitizedTag = escapeSOQL(tag);
  const query = `SELECT Id, Pool_allocation_status__c, Pool_tag__c, SignupUsername, CreatedDate, Sfdx_Auth_Url__c FROM ScratchOrgInfo WHERE Pool_tag__c = '${sanitizedTag}' AND Pool_allocation_status__c = 'available' AND Status = 'Active' ORDER BY CreatedDate ASC LIMIT 1`;

  logger.debug('Querying oldest available org', { tag, query });

  try {
    const result = await connection.query<ScratchOrgInfoRow>(query);
    if (result.records.length === 0) {
      return null;
    }
    return result.records[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to query pool for available orgs. ${message}`, 'PoolFetchQueryError');
  }
}

export async function assignOrg(connection: Connection, orgId: string): Promise<void> {
  logger.debug('Marking org as assigned', { orgId });

  try {
    /* eslint-disable camelcase */
    await connection.sobject('ScratchOrgInfo').update({
      Id: orgId,
      Pool_allocation_status__c: 'assigned',
    });
    /* eslint-enable camelcase */
    logger.debug('Org marked as assigned', { orgId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to mark org ${orgId} as assigned. ${message}`, 'PoolFetchAssignError');
  }
}

export type AuthenticateResult = {
  authInfo: AuthInfo;
  instanceUrl?: string;
};

export type FetchPoolDeps = {
  queryOldestAvailableOrg: typeof queryOldestAvailableOrg;
  assignOrg: typeof assignOrg;
  authenticateToOrg: (sfdxAuthUrl: string) => Promise<AuthenticateResult>;
  handlePostFetchSetup: (authInfo: AuthInfo, alias?: string, setDefault?: boolean) => Promise<void>;
};

export async function authenticateToOrg(sfdxAuthUrl: string): Promise<AuthenticateResult> {
  logger.debug('Authenticating to fetched org');

  try {
    const oauth2Options = AuthInfo.parseSfdxAuthUrl(sfdxAuthUrl);
    const authInfo = await AuthInfo.create({ oauth2Options });
    await authInfo.save();
    const fields = authInfo.getFields(true);
    logger.debug('Authentication successful', { username: authInfo.getUsername() });
    return { authInfo, instanceUrl: fields.instanceUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to authenticate to the fetched scratch org. ${message}`, 'PoolFetchAuthError');
  }
}

export async function handlePostFetchSetup(authInfo: AuthInfo, alias?: string, setDefault?: boolean): Promise<void> {
  await authInfo.handleAliasAndDefaultSettings({
    alias,
    setDefault: setDefault ?? false,
    setDefaultDevHub: false,
  });
}

const defaultDeps: FetchPoolDeps = {
  queryOldestAvailableOrg,
  assignOrg,
  authenticateToOrg,
  handlePostFetchSetup,
};

export async function fetchPoolOrg(
  connection: Connection,
  tag: string,
  alias?: string,
  setDefault?: boolean,
  deps: FetchPoolDeps = defaultDeps,
  onProgress?: (message: string) => void
): Promise<PoolFetchResult> {
  onProgress?.('Querying pool for available orgs...');
  const org = await deps.queryOldestAvailableOrg(connection, tag);

  if (!org) {
    throw new SfError(`No available scratch orgs found in pool '${tag}'.`, 'PoolFetchNoOrgsAvailableError');
  }

  const username = org.SignupUsername?.trim();
  if (!username) {
    throw new SfError(`Scratch org ${org.Id} has no SignupUsername.`, 'PoolFetchNoUsernameError');
  }

  onProgress?.(`Found available org: ${username}`);

  onProgress?.('Marking org as assigned...');
  await deps.assignOrg(connection, org.Id);

  if (!org.Sfdx_Auth_Url__c) {
    throw new SfError(
      `Scratch org ${org.Id} has no stored auth URL. The org may have been created before auth URL storage was enabled. Re-create the pool with the latest version of pool prepare.`,
      'PoolFetchNoAuthUrlError'
    );
  }

  onProgress?.('Authenticating to scratch org...');
  const { authInfo, instanceUrl } = await deps.authenticateToOrg(org.Sfdx_Auth_Url__c);

  if (alias ?? setDefault) {
    await deps.handlePostFetchSetup(authInfo, alias, setDefault);
    if (alias) onProgress?.(`Alias '${alias}' set for ${username}.`);
    if (setDefault) onProgress?.(`${username} set as default org.`);
  }

  return {
    username,
    orgId: org.Id,
    poolTag: org.Pool_tag__c ?? 'undefined',
    alias,
    isDefault: setDefault ?? false,
    instanceUrl,
  };
}
