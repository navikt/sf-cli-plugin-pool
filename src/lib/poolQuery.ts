import { Connection, Logger, SfError } from '@salesforce/core';
import { ScratchOrgInfoRow } from '../types/scratch-org-info.js';

const logger = Logger.childFromRoot('poolQuery');

export type PoolStats = {
  tag: string;
  total: number;
  status: Record<string, number>;
};

export type PoolAggregate = {
  pools: PoolStats[];
  allStatuses: string[];
  totalAvailable: number;
  totalOrgs: number;
};

function escapeSOQL(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function buildTagFilter(tags: string[]): string {
  if (tags.length === 0) {
    return '!= null';
  }
  const sanitized = tags.map((t) => `'${escapeSOQL(t)}'`).join(', ');
  return `IN (${sanitized})`;
}

export async function queryPoolOrgs(connection: Connection, tags: string[] = []): Promise<ScratchOrgInfoRow[]> {
  const tagFilter = buildTagFilter(tags);
  const query = `SELECT Id, Pool_allocation_status__c, Pool_tag__c FROM ScratchOrgInfo WHERE Pool_tag__c ${tagFilter} AND Status = 'Active'`;

  logger.debug('Querying pool orgs', { query });

  try {
    const result = await connection.query<ScratchOrgInfoRow>(query);
    return result.records;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new SfError(`Failed to query scratch org pool information from DevHub. ${message}`, 'PoolQueryError');
  }
}

export function aggregatePoolStats(records: ScratchOrgInfoRow[]): PoolAggregate {
  const poolMap = new Map<string, PoolStats>();

  for (const record of records) {
    const tag = record.Pool_tag__c ?? 'undefined';
    if (!poolMap.has(tag)) {
      poolMap.set(tag, { tag, total: 0, status: {} });
    }
    const pool = poolMap.get(tag)!;
    pool.total += 1;
    pool.status[record.Pool_allocation_status__c] = (pool.status[record.Pool_allocation_status__c] || 0) + 1;
  }

  const pools = Array.from(poolMap.values());
  const allStatuses = Array.from(new Set(pools.flatMap((p) => Object.keys(p.status)))).sort();

  const availableKey = allStatuses.find((s) => s.toLowerCase() === 'available');
  const totalAvailable = availableKey ? pools.reduce((sum, p) => sum + (p.status[availableKey] ?? 0), 0) : 0;
  const totalOrgs = pools.reduce((sum, p) => sum + p.total, 0);

  return { pools, allStatuses, totalAvailable, totalOrgs };
}
