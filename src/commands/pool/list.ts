import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { queryPoolOrgs, aggregatePoolStats } from '../../lib/poolQuery.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('pool', 'pool.list');

export type PoolListResult = {
  pools: Array<{
    tag: string;
    total: number;
    status: Record<string, number>;
  }>;
  totals: {
    available: number;
    totalOrgs: number;
  };
};

export default class PoolList extends SfCommand<PoolListResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'target-dev-hub': Flags.requiredHub(),
    'pool-tag': Flags.string({
      summary: messages.getMessage('flags.pool-tag.summary'),
      char: 't',
      multiple: true,
    }),
  };

  public async run(): Promise<PoolListResult> {
    this.spinner.start(messages.getMessage('info.spinner-start'));
    const { flags } = await this.parse(PoolList);

    const tags = flags['pool-tag'] ?? [];
    const devhub = flags['target-dev-hub'];
    const connection = devhub.getConnection();

    const records = await queryPoolOrgs(connection, tags);

    this.spinner.stop('Done');

    const { pools, allStatuses, totalAvailable, totalOrgs } = aggregatePoolStats(records);

    const resultJson: PoolListResult = {
      pools,
      totals: {
        available: totalAvailable,
        totalOrgs,
      },
    };

    if (!this.jsonEnabled()) {
      this.styledHeader(messages.getMessage('info.header'));
      const detailedRows = pools.map((pool) => {
        const row: Record<string, string | number> = { tag: pool.tag, total: pool.total };
        for (const s of allStatuses) row[s] = pool.status[s] ?? 0;
        return row;
      });
      this.table({ data: detailedRows });

      this.log('===================================');
      this.log(messages.getMessage('info.totals-header'));
      this.log(messages.getMessage('info.unused-count', [String(totalAvailable)]));
      this.log(messages.getMessage('info.total-count', [String(totalOrgs)]));
      this.log();
    }

    return resultJson;
  }
}
