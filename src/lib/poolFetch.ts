import { randomUUID } from 'node:crypto';
import { AuthInfo, Connection, Logger, SfError } from '@salesforce/core';
import { ScratchOrgInfoRow } from '../types/scratch-org-info.js';
import { PoolFetchResult } from '../types/pool-fetch.js';

const logger = Logger.childFromRoot('poolFetch');

// Number of oldest available orgs to query per round. Picking a random candidate from this
// batch spreads concurrent fetchers across different orgs, reducing claim collisions.
const BATCH_SIZE = 10;
// Maximum number of query+claim rounds before giving up due to contention.
const MAX_ROUNDS = 5;
// Base backoff between rounds; grows exponentially with jitter to de-synchronize concurrent callers.
const BASE_BACKOFF_MS = 200;

// Salesforce status code returned when a validation rule blocks the update. The DevHub validation
// rule on Pool_claim_token__c rejects overwriting an already-set token, which is how we detect that
// another fetch claimed the org first.
const VALIDATION_EXCEPTION = 'FIELD_CUSTOM_VALIDATION_EXCEPTION';

function escapeSOQL(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function queryAvailableOrgs(
  connection: Connection,
  tag: string,
  limit: number = BATCH_SIZE,
): Promise<ScratchOrgInfoRow[]> {
  const sanitizedTag = escapeSOQL(tag);
  const query = `SELECT Id, Pool_allocation_status__c, Pool_tag__c, SignupUsername, CreatedDate, Sfdx_Auth_Url__c FROM ScratchOrgInfo WHERE Pool_tag__c = '${sanitizedTag}' AND Pool_allocation_status__c = 'available' AND Status = 'Active' ORDER BY CreatedDate ASC LIMIT ${limit}`;

  logger.debug('Querying available orgs', { tag, query });

  try {
    const result = await connection.query<ScratchOrgInfoRow>(query);
    return result.records;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to query pool for available orgs. ${message}`, 'PoolFetchQueryError');
  }
}

type SaveError = { statusCode?: string; message?: string };
type SaveResultLike = { success?: boolean; errors?: SaveError[] };

export function isContentionError(error: unknown): boolean {
  if (error == null) return false;
  const candidate = error as { errorCode?: string; name?: string; message?: string };
  const haystack = [candidate.errorCode, candidate.name, candidate.message].filter(Boolean).join(' ');
  return haystack.includes(VALIDATION_EXCEPTION);
}

function saveErrorsAreContention(errors: SaveError[] | undefined): boolean {
  if (!errors?.length) return false;
  return errors.some(
    (e) => e.statusCode === VALIDATION_EXCEPTION || (e.message?.includes(VALIDATION_EXCEPTION) ?? false),
  );
}

/**
 * Attempts to claim an org by setting a unique claim token (and marking it assigned). A DevHub
 * validation rule rejects overwriting a token that another fetch already set.
 *
 * @returns `true` if this caller won the claim, `false` if another caller claimed it first.
 * @throws SfError for any non-contention failure.
 */
export async function claimOrg(connection: Connection, orgId: string, token: string): Promise<boolean> {
  logger.debug('Attempting to claim org', { orgId });

  try {
    /* eslint-disable camelcase */
    const result = (await connection.sobject('ScratchOrgInfo').update({
      Id: orgId,
      Pool_allocation_status__c: 'assigned',
      Pool_claim_token__c: token,
      Sfdx_Auth_Url__c: '', // Clear the auth URL so the credential does not linger after hand-off.
    })) as SaveResultLike | SaveResultLike[];
    /* eslint-enable camelcase */

    const record = Array.isArray(result) ? result[0] : result;
    if (record && record.success === false) {
      if (saveErrorsAreContention(record.errors)) {
        logger.debug('Lost claim to a concurrent fetch', { orgId });
        return false;
      }
      const detail = record.errors?.map((e) => e.message).join('; ') ?? 'unknown error';
      throw new SfError(`Failed to mark org ${orgId} as assigned. ${detail}`, 'PoolFetchAssignError');
    }

    logger.debug('Org claimed', { orgId });
    return true;
  } catch (error) {
    if (error instanceof SfError) throw error;
    if (isContentionError(error)) {
      logger.debug('Lost claim to a concurrent fetch', { orgId });
      return false;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to mark org ${orgId} as assigned. ${message}`, 'PoolFetchAssignError');
  }
}

export type AuthenticateResult = {
  authInfo: AuthInfo;
  instanceUrl?: string;
};

export type FetchPoolDeps = {
  queryAvailableOrgs: typeof queryAvailableOrgs;
  claimOrg: typeof claimOrg;
  authenticateToOrg: (sfdxAuthUrl: string) => Promise<AuthenticateResult>;
  handlePostFetchSetup: (authInfo: AuthInfo, alias?: string, setDefault?: boolean) => Promise<void>;
  generateToken: () => string;
  sleep: (ms: number) => Promise<void>;
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
  queryAvailableOrgs,
  claimOrg,
  authenticateToOrg,
  handlePostFetchSetup,
  generateToken: randomUUID,
  sleep: defaultSleep,
};

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

type ClaimedOrg = { org: ScratchOrgInfoRow; username: string; sfdxAuthUrl: string };

function validateCandidate(org: ScratchOrgInfoRow): ClaimedOrg {
  const username = org.SignupUsername?.trim();
  if (!username) {
    throw new SfError(`Scratch org ${org.Id} has no SignupUsername.`, 'PoolFetchNoUsernameError');
  }
  if (!org.Sfdx_Auth_Url__c) {
    throw new SfError(
      `Scratch org ${org.Id} has no stored auth URL. The org may have been created before auth URL storage was enabled. Re-create the pool with the latest version of pool prepare.`,
      'PoolFetchNoAuthUrlError',
    );
  }
  return { org, username, sfdxAuthUrl: org.Sfdx_Auth_Url__c };
}

async function claimAvailableOrg(
  connection: Connection,
  tag: string,
  deps: FetchPoolDeps,
  onProgress?: (message: string) => void,
): Promise<ClaimedOrg> {
  const token = deps.generateToken();

  /* eslint-disable no-await-in-loop */
  for (let round = 0; round < MAX_ROUNDS; round++) {
    onProgress?.('Querying pool for available orgs...');
    const candidates = await deps.queryAvailableOrgs(connection, tag, BATCH_SIZE);

    // No available orgs means the pool is exhausted; retrying will not help since concurrent
    // fetchers only consume more. Fail fast.
    if (candidates.length === 0) {
      throw new SfError(`No available scratch orgs found in pool '${tag}'.`, 'PoolFetchNoOrgsAvailableError');
    }

    for (const candidate of shuffle(candidates)) {
      const claimable = validateCandidate(candidate);
      onProgress?.(`Attempting to claim org: ${claimable.username}`);
      const won = await deps.claimOrg(connection, candidate.Id, token);
      if (won) {
        onProgress?.(`Claimed org: ${claimable.username}`);
        return claimable;
      }
    }

    if (round < MAX_ROUNDS - 1) {
      const backoff = Math.round(BASE_BACKOFF_MS * 2 ** round * (0.5 + Math.random() * 0.5));
      logger.debug('All candidates claimed by other fetchers, retrying', { round: round + 1, backoff });
      await deps.sleep(backoff);
    }
  }
  /* eslint-enable no-await-in-loop */

  throw new SfError(
    `Could not claim an available scratch org in pool '${tag}' after ${MAX_ROUNDS} attempts due to concurrent fetches. Try again.`,
    'PoolFetchContentionError',
  );
}

export async function fetchPoolOrg(
  connection: Connection,
  tag: string,
  alias?: string,
  setDefault?: boolean,
  deps: FetchPoolDeps = defaultDeps,
  onProgress?: (message: string) => void,
): Promise<PoolFetchResult> {
  const { org, username, sfdxAuthUrl } = await claimAvailableOrg(connection, tag, deps, onProgress);

  onProgress?.('Authenticating to scratch org...');
  const { authInfo, instanceUrl } = await deps.authenticateToOrg(sfdxAuthUrl);

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
