import { randomUUID } from 'node:crypto';
import { AuthInfo, Connection, Logger, SfError } from '@salesforce/core';
import { AvailableOrgRow } from '../types/scratch-org-info.js';
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
): Promise<AvailableOrgRow[]> {
  const sanitizedTag = escapeSOQL(tag);
  // Query from ActiveScratchOrg (traversing up to the parent ScratchOrgInfo) so a single
  // query yields both the ActiveScratchOrg Id (needed to transfer its ownership) and the
  // ScratchOrgInfo fields used to claim the org.
  const query = `SELECT Id, ScratchOrgInfo.Id, ScratchOrgInfo.Pool_allocation_status__c, ScratchOrgInfo.Pool_tag__c, ScratchOrgInfo.SignupUsername, ScratchOrgInfo.CreatedDate, ScratchOrgInfo.Sfdx_Auth_Url__c FROM ActiveScratchOrg WHERE ScratchOrgInfo.Pool_tag__c = '${sanitizedTag}' AND ScratchOrgInfo.Pool_allocation_status__c = 'available' AND ScratchOrgInfo.Status = 'Active' ORDER BY ScratchOrgInfo.CreatedDate ASC LIMIT ${limit}`;

  logger.debug('Querying available orgs', { tag, query });

  try {
    const result = await connection.query<AvailableOrgRow>(query);
    return result.records;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to query pool for available orgs. ${message}`, 'PoolFetchQueryError');
  }
}

/**
 * Resolves the Salesforce Id of the user running the fetch (the authenticated DevHub user),
 * used to transfer ownership of the claimed org's records.
 *
 * @throws SfError if the running user Id cannot be determined.
 */
export async function getRunningUserId(connection: Connection): Promise<string> {
  const userId = connection.getAuthInfoFields().userId;
  if (userId) return userId;

  try {
    const identity = await connection.identity();
    if (identity?.user_id) return identity.user_id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to resolve the running user Id. ${message}`, 'PoolFetchUserIdError');
  }

  throw new SfError('Could not resolve the running user Id from the DevHub connection.', 'PoolFetchUserIdError');
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
 * validation rule rejects overwriting a token that another fetch already set. Ownership of the
 * `ScratchOrgInfo` record is transferred to the running user as part of the same atomic update,
 * so it is only changed when this caller wins the claim.
 *
 * @returns `true` if this caller won the claim, `false` if another caller claimed it first.
 * @throws SfError for any non-contention failure.
 */
export async function claimOrg(
  connection: Connection,
  orgId: string,
  token: string,
  ownerId: string,
): Promise<boolean> {
  logger.debug('Attempting to claim org', { orgId });

  try {
    /* eslint-disable camelcase */
    const result = (await connection.sobject('ScratchOrgInfo').update({
      Id: orgId,
      Pool_allocation_status__c: 'assigned',
      Pool_claim_token__c: token,
      Sfdx_Auth_Url__c: '', // Clear the auth URL so the credential does not linger after hand-off.
      OwnerId: ownerId,
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

/**
 * Transfers ownership of an `ActiveScratchOrg` record to the running user. Called only after the
 * corresponding `ScratchOrgInfo` claim has been won, so it never touches an org this caller lost.
 *
 * @throws SfError if the ownership update fails (fatal: ownership must be guaranteed).
 */
export async function updateActiveScratchOrgOwner(
  connection: Connection,
  activeScratchOrgId: string,
  ownerId: string,
): Promise<void> {
  logger.debug('Transferring ActiveScratchOrg ownership', { activeScratchOrgId });

  try {
    /* eslint-disable camelcase */
    const result = (await connection.sobject('ActiveScratchOrg').update({
      Id: activeScratchOrgId,
      OwnerId: ownerId,
    })) as SaveResultLike | SaveResultLike[];
    /* eslint-enable camelcase */

    const record = Array.isArray(result) ? result[0] : result;
    if (record && record.success === false) {
      const detail = record.errors?.map((e) => e.message).join('; ') ?? 'unknown error';
      throw new SfError(
        `Failed to set owner on ActiveScratchOrg ${activeScratchOrgId}. ${detail}`,
        'PoolFetchActiveOrgOwnerError',
      );
    }

    logger.debug('ActiveScratchOrg ownership transferred', { activeScratchOrgId });
  } catch (error) {
    if (error instanceof SfError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(
      `Failed to set owner on ActiveScratchOrg ${activeScratchOrgId}. ${message}`,
      'PoolFetchActiveOrgOwnerError',
    );
  }
}

export type AuthenticateResult = {
  authInfo: AuthInfo;
  instanceUrl?: string;
};

export type FetchPoolDeps = {
  queryAvailableOrgs: typeof queryAvailableOrgs;
  claimOrg: typeof claimOrg;
  updateActiveScratchOrgOwner: typeof updateActiveScratchOrgOwner;
  getRunningUserId: typeof getRunningUserId;
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
  updateActiveScratchOrgOwner,
  getRunningUserId,
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

type ClaimedOrg = {
  scratchOrgInfoId: string;
  activeScratchOrgId: string;
  poolTag: string | null;
  username: string;
  sfdxAuthUrl: string;
};

function validateCandidate(candidate: AvailableOrgRow): ClaimedOrg {
  const info = candidate.ScratchOrgInfo;
  const username = info.SignupUsername?.trim();
  if (!username) {
    throw new SfError(`Scratch org ${info.Id} has no SignupUsername.`, 'PoolFetchNoUsernameError');
  }
  if (!info.Sfdx_Auth_Url__c) {
    throw new SfError(
      `Scratch org ${info.Id} has no stored auth URL. The org may have been created before auth URL storage was enabled. Re-create the pool with the latest version of pool prepare.`,
      'PoolFetchNoAuthUrlError',
    );
  }
  return {
    scratchOrgInfoId: info.Id,
    activeScratchOrgId: candidate.Id,
    poolTag: info.Pool_tag__c,
    username,
    sfdxAuthUrl: info.Sfdx_Auth_Url__c,
  };
}

async function claimAvailableOrg(
  connection: Connection,
  tag: string,
  ownerId: string,
  deps: FetchPoolDeps,
  onProgress?: (message: string) => void,
): Promise<ClaimedOrg> {
  const token = deps.generateToken();

  // A malformed candidate (missing username or auth URL) must not abort the whole fetch: other
  // available orgs in the same batch may still be claimable. Track whether any candidate passed
  // validation so we can report the right failure reason if nothing is ultimately claimed.
  let sawValidCandidate = false;
  let lastValidationError: SfError | undefined;

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
      let claimable: ClaimedOrg;
      try {
        claimable = validateCandidate(candidate);
      } catch (err) {
        // Skip this candidate and keep trying the rest. Retain the error so it can be surfaced
        // if every available candidate turns out to be invalid.
        lastValidationError = err instanceof SfError ? err : new SfError(String(err));
        logger.debug('Skipping invalid candidate', {
          scratchOrgInfoId: candidate.ScratchOrgInfo?.Id,
          reason: lastValidationError.message,
        });
        onProgress?.(
          `Skipping invalid org ${candidate.ScratchOrgInfo?.Id ?? '<unknown>'}: ${lastValidationError.message}`,
        );
        continue;
      }
      sawValidCandidate = true;
      onProgress?.(`Attempting to claim org: ${claimable.username}`);
      const won = await deps.claimOrg(connection, claimable.scratchOrgInfoId, token, ownerId);
      if (won) {
        onProgress?.(`Claimed org: ${claimable.username}`);
        // Transfer ownership of the related ActiveScratchOrg only after winning the claim, so a
        // lost candidate's ownership is never touched.
        onProgress?.('Transferring ownership...');
        await deps.updateActiveScratchOrgOwner(connection, claimable.activeScratchOrgId, ownerId);
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

  // If no candidate ever passed validation, the operative reason for failure is the invalid
  // candidate(s), not contention. Surface that instead of the generic contention message.
  if (!sawValidCandidate && lastValidationError) {
    throw lastValidationError;
  }

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
  const ownerId = await deps.getRunningUserId(connection);
  const { scratchOrgInfoId, poolTag, username, sfdxAuthUrl } = await claimAvailableOrg(
    connection,
    tag,
    ownerId,
    deps,
    onProgress,
  );

  onProgress?.('Authenticating to scratch org...');
  const { authInfo, instanceUrl } = await deps.authenticateToOrg(sfdxAuthUrl);

  if (alias ?? setDefault) {
    await deps.handlePostFetchSetup(authInfo, alias, setDefault);
    if (alias) onProgress?.(`Alias '${alias}' set for ${username}.`);
    if (setDefault) onProgress?.(`${username} set as default org.`);
  }

  return {
    username,
    orgId: scratchOrgInfoId,
    poolTag: poolTag ?? 'undefined',
    alias,
    isDefault: setDefault ?? false,
    instanceUrl,
  };
}
