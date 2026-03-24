import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Connection, SfError } from '@salesforce/core';
import { buildTagFilter, aggregatePoolStats, queryPoolOrgs } from '../../src/lib/poolQuery.js';
import { ScratchOrgInfoRow } from '../../src/types/scratch-org-info.js';

describe('poolQuery', () => {
  const $$ = new TestContext();

  afterEach(() => {
    $$.restore();
  });

  /* eslint-disable camelcase */

  // ---------------------------------------------------------------------------
  // buildTagFilter
  // ---------------------------------------------------------------------------
  describe('buildTagFilter', () => {
    it('returns != null for empty array', () => {
      expect(buildTagFilter([])).to.equal('!= null');
    });

    it('returns IN clause for a single tag', () => {
      expect(buildTagFilter(['tag1'])).to.equal("IN ('tag1')");
    });

    it('returns IN clause for multiple tags', () => {
      expect(buildTagFilter(['tag1', 'tag2'])).to.equal("IN ('tag1', 'tag2')");
    });

    it('escapes single quotes in tag names to prevent SOQL injection', () => {
      expect(buildTagFilter(["it's"])).to.equal("IN ('it\\'s')");
    });

    it('escapes backslashes in tag names', () => {
      expect(buildTagFilter(['back\\slash'])).to.equal("IN ('back\\\\slash')");
    });

    it('escapes both backslashes and single quotes together', () => {
      // Input: a\'b  →  backslash escaped first → a\\'b → then quote escaped → a\\\'b
      expect(buildTagFilter(["a\\'b"])).to.equal("IN ('a\\\\\\'b')");
    });
  });

  // ---------------------------------------------------------------------------
  // aggregatePoolStats
  // ---------------------------------------------------------------------------
  describe('aggregatePoolStats', () => {
    it('returns empty pools and zero totals for empty records array', () => {
      const result = aggregatePoolStats([]);

      expect(result.pools).to.deep.equal([]);
      expect(result.allStatuses).to.deep.equal([]);
      expect(result.totalAvailable).to.equal(0);
      expect(result.totalOrgs).to.equal(0);
    });

    it('groups records by Pool_tag__c', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolA' },
        { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolB' },
        { Id: '003', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolA' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.pools).to.have.lengthOf(2);
      const poolA = result.pools.find((p) => p.tag === 'poolA')!;
      const poolB = result.pools.find((p) => p.tag === 'poolB')!;
      expect(poolA).to.exist;
      expect(poolB).to.exist;
      expect(poolA.total).to.equal(2);
      expect(poolB.total).to.equal(1);
    });

    it('counts statuses correctly within a pool', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'pool1' },
        { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'pool1' },
        { Id: '003', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1' },
        { Id: '004', Pool_allocation_status__c: 'Provisioning', Pool_tag__c: 'pool1' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.pools).to.have.lengthOf(1);
      const pool = result.pools[0];
      expect(pool.status['Available']).to.equal(2);
      expect(pool.status['In Use']).to.equal(1);
      expect(pool.status['Provisioning']).to.equal(1);
      expect(pool.total).to.equal(4);
    });

    it('maps null Pool_tag__c to "undefined" tag', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: null },
        { Id: '002', Pool_allocation_status__c: 'In Use', Pool_tag__c: null },
      ];

      const result = aggregatePoolStats(records);

      expect(result.pools).to.have.lengthOf(1);
      expect(result.pools[0].tag).to.equal('undefined');
      expect(result.pools[0].total).to.equal(2);
    });

    it('returns totalAvailable=0 when no "Available" status exists', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1' },
        { Id: '002', Pool_allocation_status__c: 'Provisioning', Pool_tag__c: 'pool1' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.totalAvailable).to.equal(0);
    });

    it('calculates correct totalAvailable across multiple pools', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolA' },
        { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolA' },
        { Id: '003', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'poolA' },
        { Id: '004', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolB' },
        { Id: '005', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'poolB' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.totalAvailable).to.equal(3);
      expect(result.totalOrgs).to.equal(5);
    });

    it('returns sorted allStatuses', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Provisioning', Pool_tag__c: 'pool1' },
        { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'pool1' },
        { Id: '003', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.allStatuses).to.deep.equal(['Available', 'In Use', 'Provisioning']);
    });

    it('handles case-insensitive "available" matching for totalAvailable', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'available', Pool_tag__c: 'pool1' },
        { Id: '002', Pool_allocation_status__c: 'available', Pool_tag__c: 'pool1' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.totalAvailable).to.equal(2);
    });

    it('handles "Available" with standard casing for totalAvailable', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'pool1' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.totalAvailable).to.equal(1);
    });

    it('deduplicates statuses across pools in allStatuses', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolA' },
        { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolB' },
        { Id: '003', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'poolA' },
      ];

      const result = aggregatePoolStats(records);

      expect(result.allStatuses).to.deep.equal(['Available', 'In Use']);
    });

    it('handles mixed null and non-null Pool_tag__c values', () => {
      const records: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'pool1' },
        { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: null },
      ];

      const result = aggregatePoolStats(records);

      expect(result.pools).to.have.lengthOf(2);
      const named = result.pools.find((p) => p.tag === 'pool1')!;
      const undef = result.pools.find((p) => p.tag === 'undefined')!;
      expect(named).to.exist;
      expect(undef).to.exist;
      expect(named.total).to.equal(1);
      expect(undef.total).to.equal(1);
      expect(result.totalOrgs).to.equal(2);
    });
  });

  // ---------------------------------------------------------------------------
  // queryPoolOrgs
  // ---------------------------------------------------------------------------
  describe('queryPoolOrgs', () => {
    it('returns records from the connection query', async () => {
      const expectedRecords: ScratchOrgInfoRow[] = [
        { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'pool1' },
        { Id: '002', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1' },
      ];

      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({
          totalSize: expectedRecords.length,
          done: true,
          records: expectedRecords,
        }),
      };

      const result = await queryPoolOrgs(fakeConnection as unknown as Connection);

      expect(result).to.deep.equal(expectedRecords);
    });

    it('throws SfError with name PoolQueryError when connection.query fails', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().rejects(new Error('INVALID_FIELD: No such column')),
      };

      try {
        await queryPoolOrgs(fakeConnection as unknown as Connection);
        expect.fail('Expected queryPoolOrgs to throw');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        const sfErr = err as SfError;
        expect(sfErr.name).to.equal('PoolQueryError');
        expect(sfErr.message).to.include('Failed to query scratch org pool information from DevHub');
        expect(sfErr.message).to.include('INVALID_FIELD: No such column');
      }
    });

    it('passes correct SOQL query with no tags (default filter)', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      await queryPoolOrgs(fakeConnection as unknown as Connection);

      expect(fakeConnection.query.calledOnce).to.be.true;
      const queryArg = fakeConnection.query.firstCall.args[0] as string;
      expect(queryArg).to.include('Pool_tag__c != null');
      expect(queryArg).to.include("Status = 'Active'");
      expect(queryArg).to.include('SELECT Id, Pool_allocation_status__c, Pool_tag__c FROM ScratchOrgInfo');
    });

    it('passes correct SOQL query with specific tags', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      await queryPoolOrgs(fakeConnection as unknown as Connection, ['myPool', 'otherPool']);

      expect(fakeConnection.query.calledOnce).to.be.true;
      const queryArg = fakeConnection.query.firstCall.args[0] as string;
      expect(queryArg).to.include("Pool_tag__c IN ('myPool', 'otherPool')");
      expect(queryArg).to.include("Status = 'Active'");
    });

    it('passes correct SOQL query with a single tag', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      await queryPoolOrgs(fakeConnection as unknown as Connection, ['singleTag']);

      const queryArg = fakeConnection.query.firstCall.args[0] as string;
      expect(queryArg).to.include("Pool_tag__c IN ('singleTag')");
    });

    it('wraps non-Error thrown values in SfError message', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().rejects('some string error'),
      };

      try {
        await queryPoolOrgs(fakeConnection as unknown as Connection);
        expect.fail('Expected queryPoolOrgs to throw');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        const sfErr = err as SfError;
        expect(sfErr.name).to.equal('PoolQueryError');
        expect(sfErr.message).to.include('Failed to query scratch org pool information from DevHub');
      }
    });
  });
});
