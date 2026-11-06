import { AuthInfo, AuthRemover, Connection, Logger, Messages, Org, SfError, trimTo15 } from '@salesforce/core';
import { ReturnOrgRow } from '../types/scratch-org-info.js';
import { PoolReturnResult } from '../types/pool-return.js';
import { getRunningUserId } from './poolFetch.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@navikt/sf-cli-plugin-pool', 'pool.return');
const logger = Logger.childFromRoot('poolReturn');

const ACTIVE = 'Active';
const ASSIGNED = 'assigned';
const AVAILABLE = 'available';
const SALESFORCE_ID_15 = /^[a-zA-Z0-9]{15}$/;
const SCRATCH_ORG_INFO_REF = 'scratchOrgInfo';
const ACTIVE_SCRATCH_ORG_REF = 'activeScratchOrg';
const PRECONDITION_FAILED_STATUS = 412;
const PRECONDITION_FAILED = 'PRECONDITION_FAILED';
// Error code Salesforce reports on subrequests skipped after an earlier subrequest failed.
const PROCESSING_HALTED = 'PROCESSING_HALTED';
const REDACTED = '[REDACTED]';

/**
 * The Dev Hub changes that return an org to its pool. `ifUnmodifiedSince` is the HTTP-date of the
 * observed `ScratchOrgInfo.LastModifiedDate`; the transaction is rejected if the record changed since.
 */
export type ReturnUpdate = {
  username: string;
  scratchOrgInfoId: string;
  scratchOrgInfoOwnerId: string;
  activeScratchOrgId: string;
  activeScratchOrgOwnerId: string;
  sfdxAuthUrl: string;
  ifUnmodifiedSince: string;
};

type CompositeSubresponse = { body?: unknown; httpStatusCode?: number; referenceId?: string };
type CompositeResponse = { compositeResponse?: CompositeSubresponse[] };
type ApiError = { errorCode?: unknown; message?: unknown };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  const trimmedLeft = trimTo15(left ?? undefined);
  return trimmedLeft !== undefined && trimmedLeft === trimTo15(right ?? undefined);
}

function redact(text: string, secret: string): string {
  const withoutSecret = secret ? text.split(secret).join(REDACTED) : text;
  return withoutSecret.replace(/force:\/\/\S+/g, REDACTED);
}

/**
 * Converts a Salesforce datetime (e.g. `2025-01-01T12:00:00.000+0000`) to an HTTP-date.
 *
 * @returns the HTTP-date, or `undefined` if the value can't be parsed.
 */
export function toHttpDate(salesforceDateTime: string | null | undefined): string | undefined {
  if (!salesforceDateTime) return undefined;
  const date = new Date(salesforceDateTime.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(date.getTime()) ? undefined : date.toUTCString();
}

/**
 * Looks up a scratch org in the Dev Hub by its org Id, returning the `ActiveScratchOrg` records whose
 * org Id matches exactly.
 *
 * @throws SfError if the org Id is invalid or the query fails.
 */
export async function queryReturnOrg(connection: Connection, scratchOrgId: string): Promise<ReturnOrgRow[]> {
  const trimmedId = trimTo15(scratchOrgId);
  if (!trimmedId || !SALESFORCE_ID_15.test(trimmedId)) {
    throw new SfError(messages.getMessage('error.invalid-org-id', [scratchOrgId]), 'PoolReturnQueryError');
  }

  const query = `SELECT Id, ScratchOrg, OwnerId, CreatedById, ScratchOrgInfo.Id, ScratchOrgInfo.SignupUsername, ScratchOrgInfo.Status, ScratchOrgInfo.Pool_tag__c, ScratchOrgInfo.Pool_allocation_status__c, ScratchOrgInfo.OwnerId, ScratchOrgInfo.CreatedById, ScratchOrgInfo.LastModifiedDate FROM ActiveScratchOrg WHERE ScratchOrg = '${trimmedId}'`;
  logger.debug('Querying org to return', { scratchOrgId: trimmedId });

  let records: ReturnOrgRow[];
  try {
    records = (await connection.query<ReturnOrgRow>(query)).records;
  } catch (error) {
    throw new SfError(messages.getMessage('error.query', [trimmedId, errorMessage(error)]), 'PoolReturnQueryError');
  }

  // SOQL compares Ids case-insensitively, but 15-character Ids are case-sensitive.
  return records.filter((record) => trimTo15(record.ScratchOrg) === trimmedId);
}

function isSuccessStatus(status: number | undefined): boolean {
  return status !== undefined && status >= 200 && status < 300;
}

function toApiErrors(subresponse: CompositeSubresponse): ApiError[] {
  const entries: unknown[] = Array.isArray(subresponse.body) ? (subresponse.body as unknown[]) : [subresponse.body];
  return entries.filter((entry): entry is ApiError => typeof entry === 'object' && entry !== null);
}

function isStale(subresponse: CompositeSubresponse | undefined): boolean {
  if (!subresponse) return false;
  return (
    subresponse.httpStatusCode === PRECONDITION_FAILED_STATUS ||
    toApiErrors(subresponse).some((entry) => entry.errorCode === PRECONDITION_FAILED)
  );
}

function describeFailures(failures: CompositeSubresponse[]): string {
  const details = failures
    .flatMap(toApiErrors)
    .filter((entry) => entry.errorCode !== PROCESSING_HALTED)
    .map((entry) => [entry.errorCode, entry.message].filter((part) => typeof part === 'string').join(': '))
    .filter(Boolean);
  if (details.length) return details.join('; ');
  return failures.map((failure) => `${failure.referenceId ?? '?'}: HTTP ${failure.httpStatusCode ?? '?'}`).join('; ');
}

// Errors the Dev Hub returns before processing a request. Any other failure (network errors,
// timeouts, or 5xx responses such as UNKNOWN_EXCEPTION) may follow a committed transaction.
const DEFINITE_REJECTION_CODES = new Set([
  'API_CURRENTLY_DISABLED',
  'API_DISABLED_FOR_ORG',
  'INVALID_AUTH_HEADER',
  'INVALID_SESSION_ID',
  'JSON_PARSER_ERROR',
  'METHOD_NOT_ALLOWED',
  'NOT_FOUND',
  'REQUEST_LIMIT_EXCEEDED',
]);

function isDefiniteRejection(error: unknown): boolean {
  const errorCode = (error as { errorCode?: unknown } | null)?.errorCode;
  // A request timeout does not confirm whether the transaction committed.
  if (errorCode === 'ERROR_HTTP_408') return false;
  return (
    typeof errorCode === 'string' && (DEFINITE_REJECTION_CODES.has(errorCode) || /^ERROR_HTTP_4\d\d$/.test(errorCode))
  );
}

function uncertainError(update: ReturnUpdate, detail: string): SfError {
  return new SfError(
    messages.getMessage('error.uncertain', [update.username, update.username, redact(detail, update.sfdxAuthUrl)]),
    'PoolReturnUncertainError',
  );
}

function assertTransactionSucceeded(response: CompositeResponse | undefined, update: ReturnUpdate): void {
  const subresponses = Array.isArray(response?.compositeResponse) ? response.compositeResponse : [];
  const scratchOrgInfo = subresponses.find((entry) => entry.referenceId === SCRATCH_ORG_INFO_REF);
  const activeScratchOrg = subresponses.find((entry) => entry.referenceId === ACTIVE_SCRATCH_ORG_REF);
  if (isSuccessStatus(scratchOrgInfo?.httpStatusCode) && isSuccessStatus(activeScratchOrg?.httpStatusCode)) return;

  const failures = subresponses.filter((entry) => !isSuccessStatus(entry.httpStatusCode));
  if (failures.length === 0) {
    throw uncertainError(update, messages.getMessage('error.unexpected-response'));
  }
  if (isStale(scratchOrgInfo)) {
    throw new SfError(messages.getMessage('error.stale', [update.username]), 'PoolReturnStaleError');
  }
  throw new SfError(
    messages.getMessage('error.update', [update.username, redact(describeFailures(failures), update.sfdxAuthUrl)]),
    'PoolReturnUpdateError',
  );
}

/**
 * Returns an org to its pool in a single all-or-none Composite request: restores both records' owners,
 * restores the auth URL, clears the claim token, and marks the `ScratchOrgInfo` as available. The
 * `ScratchOrgInfo` update is conditional on `ifUnmodifiedSince`, so a concurrent fetch or return
 * rejects the whole transaction. Never retried, since a replay could overwrite a newer assignment.
 *
 * @throws SfError `PoolReturnStaleError` if the org changed, `PoolReturnUpdateError` if the Dev Hub
 * rejected the transaction, or `PoolReturnUncertainError` if the outcome is unknown.
 */
export async function submitReturnTransaction(connection: Connection, update: ReturnUpdate): Promise<void> {
  const apiPath = `/services/data/v${connection.getApiVersion()}`;
  /* eslint-disable camelcase */
  const body = {
    allOrNone: true,
    compositeRequest: [
      {
        method: 'PATCH',
        url: `${apiPath}/sobjects/ScratchOrgInfo/${update.scratchOrgInfoId}`,
        referenceId: SCRATCH_ORG_INFO_REF,
        httpHeaders: { 'If-Unmodified-Since': update.ifUnmodifiedSince },
        body: {
          OwnerId: update.scratchOrgInfoOwnerId,
          Sfdx_Auth_Url__c: update.sfdxAuthUrl,
          Pool_claim_token__c: null,
          Pool_allocation_status__c: AVAILABLE,
        },
      },
      {
        method: 'PATCH',
        url: `${apiPath}/sobjects/ActiveScratchOrg/${update.activeScratchOrgId}`,
        referenceId: ACTIVE_SCRATCH_ORG_REF,
        body: { OwnerId: update.activeScratchOrgOwnerId },
      },
    ],
  };
  /* eslint-enable camelcase */

  logger.debug('Submitting return transaction', {
    scratchOrgInfoId: update.scratchOrgInfoId,
    activeScratchOrgId: update.activeScratchOrgId,
  });

  let response: CompositeResponse | undefined;
  try {
    response = await connection.request<CompositeResponse>({
      method: 'POST',
      url: `${apiPath}/composite`,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    });
  } catch (error) {
    if (!isDefiniteRejection(error)) throw uncertainError(update, errorMessage(error));
    throw new SfError(
      messages.getMessage('error.update', [update.username, redact(errorMessage(error), update.sfdxAuthUrl)]),
      'PoolReturnUpdateError',
    );
  }

  assertTransactionSucceeded(response, update);
  logger.debug('Return transaction committed', { scratchOrgInfoId: update.scratchOrgInfoId });
}

export function getSfdxAuthUrl(org: Org): string {
  return org.getConnection().getAuthInfo().getSfdxAuthUrl();
}

/** Removes the org's local auth file, aliases, and matching global and project default-org settings. */
export async function removeLocalAuth(username: string): Promise<void> {
  const remover = await AuthRemover.create();
  await remover.removeAuth(username);
}

export type ReturnPoolDeps = {
  getRunningUserId: (connection: Connection) => Promise<string>;
  queryReturnOrg: typeof queryReturnOrg;
  getSfdxAuthUrl: (org: Org) => string;
  submitReturnTransaction: typeof submitReturnTransaction;
  removeLocalAuth: (username: string) => Promise<void>;
};

const defaultDeps: ReturnPoolDeps = {
  getRunningUserId,
  queryReturnOrg,
  getSfdxAuthUrl,
  submitReturnTransaction,
  removeLocalAuth,
};

type ReturnCandidate = Omit<ReturnUpdate, 'username' | 'sfdxAuthUrl'> & { poolTag: string };

function validateCandidate(row: ReturnOrgRow, username: string, runningUserId: string): ReturnCandidate {
  const info = row.ScratchOrgInfo;
  if (!info) {
    throw new SfError(messages.getMessage('error.missing-parent', [username]), 'PoolReturnNotFoundError');
  }
  if (info.Status !== ACTIVE) {
    throw new SfError(
      messages.getMessage('error.not-active', [username, String(info.Status)]),
      'PoolReturnNotActiveError',
    );
  }
  if (!info.Pool_tag__c) {
    throw new SfError(messages.getMessage('error.not-pool-org', [username]), 'PoolReturnNotPoolOrgError');
  }
  if (info.Pool_allocation_status__c !== ASSIGNED) {
    throw new SfError(
      messages.getMessage('error.not-assigned', [username, String(info.Pool_allocation_status__c)]),
      'PoolReturnNotAssignedError',
    );
  }
  if (!sameId(info.OwnerId, runningUserId)) {
    throw new SfError(messages.getMessage('error.not-owner', ['ScratchOrgInfo', username]), 'PoolReturnNotOwnerError');
  }
  if (!sameId(row.OwnerId, runningUserId)) {
    throw new SfError(
      messages.getMessage('error.not-owner', ['ActiveScratchOrg', username]),
      'PoolReturnNotOwnerError',
    );
  }
  if (!info.CreatedById) {
    throw new SfError(
      messages.getMessage('error.missing-creator', ['ScratchOrgInfo', username]),
      'PoolReturnMissingCreatorError',
    );
  }
  if (!row.CreatedById) {
    throw new SfError(
      messages.getMessage('error.missing-creator', ['ActiveScratchOrg', username]),
      'PoolReturnMissingCreatorError',
    );
  }
  // Only restore credentials of the signup user; another user's auth URL would be stored under the wrong username.
  if (info.SignupUsername?.toLowerCase() !== username.toLowerCase()) {
    throw new SfError(
      messages.getMessage('error.username-mismatch', [username, String(info.SignupUsername)]),
      'PoolReturnUsernameMismatchError',
    );
  }
  const ifUnmodifiedSince = toHttpDate(info.LastModifiedDate);
  if (!ifUnmodifiedSince) {
    throw new SfError(messages.getMessage('error.invalid-timestamp', [username]), 'PoolReturnQueryError');
  }

  return {
    scratchOrgInfoId: info.Id,
    scratchOrgInfoOwnerId: info.CreatedById,
    activeScratchOrgId: row.Id,
    activeScratchOrgOwnerId: row.CreatedById,
    poolTag: info.Pool_tag__c,
    ifUnmodifiedSince,
  };
}

function resolveSfdxAuthUrl(scratchOrg: Org, username: string, deps: ReturnPoolDeps): string {
  try {
    const sfdxAuthUrl = deps.getSfdxAuthUrl(scratchOrg);
    // Validate with the same parser `pool fetch` uses to authenticate with the restored URL.
    AuthInfo.parseSfdxAuthUrl(sfdxAuthUrl);
    return sfdxAuthUrl;
  } catch {
    throw new SfError(messages.getMessage('error.auth-url', [username]), 'PoolReturnAuthUrlError');
  }
}

async function resolveRunningUserId(connection: Connection, deps: ReturnPoolDeps): Promise<string> {
  try {
    return await deps.getRunningUserId(connection);
  } catch (error) {
    throw new SfError(messages.getMessage('error.user-id', [errorMessage(error)]), 'PoolReturnUserIdError');
  }
}

/**
 * Returns a fetched org to its pool. Everything is validated before the Dev Hub is changed, and
 * local auth is removed only after the Dev Hub transaction is confirmed.
 *
 * @param connection Dev Hub connection of the user who fetched the org.
 * @param scratchOrg The locally authenticated scratch org to return.
 */
export async function returnPoolOrg(
  connection: Connection,
  scratchOrg: Org,
  deps: ReturnPoolDeps = defaultDeps,
  onProgress?: (message: string) => void,
): Promise<PoolReturnResult> {
  const scratchOrgId = scratchOrg.getOrgId();
  const username = scratchOrg.getUsername();
  if (!username) {
    throw new SfError(messages.getMessage('error.auth-url', [scratchOrgId]), 'PoolReturnAuthUrlError');
  }

  onProgress?.(messages.getMessage('info.progress-verify', [username]));
  const runningUserId = await resolveRunningUserId(connection, deps);
  const rows = await deps.queryReturnOrg(connection, scratchOrgId);
  if (rows.length === 0) {
    throw new SfError(
      messages.getMessage('error.not-found', [username, scratchOrgId, String(connection.getUsername())]),
      'PoolReturnNotFoundError',
    );
  }
  if (rows.length > 1) {
    throw new SfError(
      messages.getMessage('error.multiple-records', [username, scratchOrgId]),
      'PoolReturnMultipleRecordsError',
    );
  }

  const candidate = validateCandidate(rows[0], username, runningUserId);
  const sfdxAuthUrl = resolveSfdxAuthUrl(scratchOrg, username, deps);

  onProgress?.(messages.getMessage('info.progress-update', [username, candidate.poolTag]));
  await deps.submitReturnTransaction(connection, {
    username,
    scratchOrgInfoId: candidate.scratchOrgInfoId,
    scratchOrgInfoOwnerId: candidate.scratchOrgInfoOwnerId,
    activeScratchOrgId: candidate.activeScratchOrgId,
    activeScratchOrgOwnerId: candidate.activeScratchOrgOwnerId,
    sfdxAuthUrl,
    ifUnmodifiedSince: candidate.ifUnmodifiedSince,
  });

  onProgress?.(messages.getMessage('info.progress-cleanup', [username]));
  const warnings: string[] = [];
  let localAuthRemoved = true;
  try {
    await deps.removeLocalAuth(username);
  } catch (error) {
    localAuthRemoved = false;
    logger.warn('Returned org but failed to remove local auth', { username, error: errorMessage(error) });
    warnings.push(messages.getMessage('warning.local-auth-not-removed', [username, errorMessage(error), username]));
  }

  return {
    username,
    orgId: candidate.scratchOrgInfoId,
    activeScratchOrgId: candidate.activeScratchOrgId,
    poolTag: candidate.poolTag,
    scratchOrgInfoOwnerId: candidate.scratchOrgInfoOwnerId,
    activeScratchOrgOwnerId: candidate.activeScratchOrgOwnerId,
    status: AVAILABLE,
    localAuthRemoved,
    warnings,
  };
}
