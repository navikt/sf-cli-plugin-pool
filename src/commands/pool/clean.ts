import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { queryPoolOrgsForClean } from '../../lib/poolQuery.js';
import { cleanPoolOrgs } from '../../lib/poolClean.js';
import { PoolCleanResult } from '../../types/pool-clean.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@navikt/sf-cli-plugin-pool', 'pool.clean');

const IN_USE_STATUS = 'assigned';
const DEFAULT_STATUSES = ['failed'];

const STATUS_LABEL_TO_API: Record<string, string> = {
  'in progress': 'in_progress',
  available: 'available',
  'under update': 'under_update',
  failed: 'failed',
  assigned: 'assigned',
};

function normalizeStatusInput(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (STATUS_LABEL_TO_API[normalized]) {
    return STATUS_LABEL_TO_API[normalized];
  }

  const normalizedApi = normalized.replace(/[\s-]+/g, '_');
  return STATUS_LABEL_TO_API[normalizedApi.replace(/_/g, ' ')] ?? normalizedApi;
}

export default class PoolClean extends SfCommand<PoolCleanResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-dev-hub': Flags.requiredHub(),
    'api-version': Flags.orgApiVersion(),
    'pool-tag': Flags.string({
      summary: messages.getMessage('flags.pool-tag.summary'),
      char: 't',
      multiple: true,
    }),
    status: Flags.string({
      summary: messages.getMessage('flags.status.summary'),
      char: 's',
      multiple: true,
      exclusive: ['all'],
    }),
    all: Flags.boolean({
      summary: messages.getMessage('flags.all.summary'),
      exclusive: ['status'],
    }),
    'no-prompt': Flags.boolean({
      summary: messages.getMessage('flags.no-prompt.summary'),
    }),
  };

  public async run(): Promise<PoolCleanResult> {
    const { flags } = await this.parse(PoolClean);

    const tags = flags['pool-tag'] ?? [];
    const statuses = flags.all ? [] : (flags.status ?? DEFAULT_STATUSES).map(normalizeStatusInput);
    const devhub = flags['target-dev-hub'];
    const connection = devhub.getConnection(flags['api-version']);

    this.spinner.start(messages.getMessage('info.spinner-start'));
    const orgs = await queryPoolOrgsForClean(connection, tags, statuses);
    this.spinner.stop(messages.getMessage('info.spinner-done'));

    if (orgs.length === 0) {
      if (!this.jsonEnabled()) {
        this.log(messages.getMessage('info.no-orgs'));
      }
      return { orgs: [], summary: { deleted: 0, failed: 0, total: 0 } };
    }

    if (!this.jsonEnabled()) {
      this.log(messages.getMessage('info.found-orgs', [String(orgs.length)]));
    }

    const hasAssigned = orgs.some((o) => o.Pool_allocation_status__c === IN_USE_STATUS);
    if (hasAssigned && !flags['no-prompt']) {
      const assignedCount = orgs.filter((o) => o.Pool_allocation_status__c === IN_USE_STATUS).length;
      const confirmed = await this.confirm({
        message: messages.getMessage('prompt.confirm-in-use', [String(assignedCount)]),
      });
      if (!confirmed) {
        if (!this.jsonEnabled()) {
          this.log(messages.getMessage('error.prompt-declined'));
        }
        return { orgs: [], summary: { deleted: 0, failed: 0, total: 0 } };
      }
    }

    const logProgress = this.jsonEnabled() ? undefined : (msg: string): void => this.log(msg);
    const result = await cleanPoolOrgs(orgs, undefined, logProgress);

    if (!this.jsonEnabled()) {
      this.styledHeader(messages.getMessage('info.summary-header'));
      this.log(
        messages.getMessage('info.summary', [
          String(result.summary.deleted),
          String(result.summary.failed),
          String(result.summary.total),
        ]),
      );
      this.log();
    }

    return result;
  }
}
