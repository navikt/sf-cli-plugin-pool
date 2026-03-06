import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('pool', 'pool.list');

export type PoolListResult = {
  pools: Array<{
    tag: string;
    total: number;
    status: Record<string, number>;
  }>;
  totals: {
    available?: number;
    totalOrgs: number;
  };
};

type ScratchOrgInfoRow = {
  Id: string;
  Allocation_status__c: string;
  Pooltag__c: string | null;
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
    this.spinner.start('Listing Scratch Org Pools...');
    const { flags } = await this.parse(PoolList);

    const tags = flags['pool-tag'] ?? [];
    const tagsString = `IN ('${tags.join("', '")}')`;
    const tagFilter = `${tags.length > 0 ? tagsString : '!= null'}`;

    const devhub = flags['target-dev-hub'];
    const connection = devhub.getConnection();

    const query = `SELECT Id, Allocation_status__c, Pooltag__c FROM ScratchOrgInfo WHERE Pooltag__c ${tagFilter} AND Status = 'Active'`;
    const result = await connection.query<ScratchOrgInfoRow>(query);

    this.spinner.stop('Done');

    // Build pools directly in resultJson
    const poolMap = new Map<string, { tag: string; total: number; status: Record<string, number> }>();

    result.records.forEach((record) => {
      const tag = record.Pooltag__c ?? 'undefined';
      if (!poolMap.has(tag)) {
        poolMap.set(tag, { tag, total: 0, status: {} });
      }
      const pool = poolMap.get(tag)!;
      pool.total += 1;
      pool.status[record.Allocation_status__c] = (pool.status[record.Allocation_status__c] || 0) + 1;
    });

    const pools = Array.from(poolMap.values());
    const allStatuses = Array.from(new Set(pools.flatMap((p) => Object.keys(p.status)))).sort();

    const availableKey = allStatuses.find((s) => s.toLowerCase() === 'available');
    const totalAvailable = availableKey ? pools.reduce((sum, p) => sum + (p.status[availableKey] ?? 0), 0) : undefined;
    const totalOrgs = pools.reduce((sum, p) => sum + p.total, 0);

    const resultJson: PoolListResult = {
      pools,
      totals: {
        available: totalAvailable,
        totalOrgs,
      },
    };

    // Human-readable output
    if (!this.jsonEnabled()) {
      this.styledHeader('Scratch Pool Details');
      const detailedRows = pools.map((pool) => {
        const row: Record<string, string | number> = { tag: pool.tag, total: pool.total };
        for (const s of allStatuses) row[s] = pool.status[s] ?? 0;
        return row;
      });
      this.table({ data: detailedRows });

      this.log('===================================');
      this.log('Scratch Org Pool Totals:');
      this.log(`Unused Scratch Orgs in the Pool : ${String(totalAvailable)}`);
      this.log(`Total Scratch Orgs in the Pool : ${String(totalOrgs)}`);
      this.log();
    }

    return resultJson;
  }
}
