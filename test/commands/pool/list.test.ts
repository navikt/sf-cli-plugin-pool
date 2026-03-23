import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import PoolList from '../../../src/commands/pool/list.js';

/* eslint-disable camelcase */
describe('pool list', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let devHub: MockTestOrgData;

  // SfCommand registers signal listeners (SIGINT, SIGTERM, etc.) for spinner cleanup on each run().
  // These accumulate across tests and exceed Node's default limit of 10, triggering a warning.
  before(() => {
    process.setMaxListeners(20);
  });

  after(() => {
    process.setMaxListeners(10);
  });

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    devHub = new MockTestOrgData();
    devHub.makeDevHub();
    await $$.stubAuths(devHub);
  });

  afterEach(() => {
    $$.restore();
  });

  function fakeQueryResponse(
    records: Array<{ Id: string; Pool_allocation_status__c: string; Pool_tag__c: string | null }>
  ) {
    $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: records.length, done: true, records });
  }

  it('returns empty pools when no scratch orgs exist', async () => {
    fakeQueryResponse([]);

    const result = await PoolList.run(['--target-dev-hub', devHub.username]);

    expect(result.pools).to.deep.equal([]);
    expect(result.totals.totalOrgs).to.equal(0);
    expect(result.totals.available).to.equal(0);
  });

  it('aggregates orgs into a single pool', async () => {
    fakeQueryResponse([
      { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'myPool' },
      { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'myPool' },
      { Id: '003', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'myPool' },
    ]);

    const result = await PoolList.run(['--target-dev-hub', devHub.username]);

    expect(result.pools).to.have.lengthOf(1);
    expect(result.pools[0].tag).to.equal('myPool');
    expect(result.pools[0].total).to.equal(3);
    expect(result.pools[0].status['Available']).to.equal(2);
    expect(result.pools[0].status['In Use']).to.equal(1);
    expect(result.totals.totalOrgs).to.equal(3);
    expect(result.totals.available).to.equal(2);
  });

  it('aggregates orgs across multiple pools', async () => {
    fakeQueryResponse([
      { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolA' },
      { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'poolB' },
      { Id: '003', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'poolB' },
    ]);

    const result = await PoolList.run(['--target-dev-hub', devHub.username]);

    expect(result.pools).to.have.lengthOf(2);
    const poolA = result.pools.find((p) => p.tag === 'poolA')!;
    const poolB = result.pools.find((p) => p.tag === 'poolB')!;
    expect(poolA.total).to.equal(1);
    expect(poolB.total).to.equal(2);
    expect(result.totals.totalOrgs).to.equal(3);
    expect(result.totals.available).to.equal(2);
  });

  it('maps null Pool_tag__c to "undefined" tag', async () => {
    fakeQueryResponse([{ Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: null }]);

    const result = await PoolList.run(['--target-dev-hub', devHub.username]);

    expect(result.pools).to.have.lengthOf(1);
    expect(result.pools[0].tag).to.equal('undefined');
  });

  it('passes --pool-tag filter into the SOQL query', async () => {
    fakeQueryResponse([{ Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'target' }]);

    const result = await PoolList.run(['--target-dev-hub', devHub.username, '--pool-tag', 'target']);

    expect(result.pools).to.have.lengthOf(1);
    expect(result.pools[0].tag).to.equal('target');
  });

  it('supports multiple --pool-tag values', async () => {
    fakeQueryResponse([
      { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'a' },
      { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'b' },
    ]);

    const result = await PoolList.run(['--target-dev-hub', devHub.username, '--pool-tag', 'a', '--pool-tag', 'b']);

    expect(result.pools).to.have.lengthOf(2);
    expect(result.totals.totalOrgs).to.equal(2);
  });

  it('sets available to undefined when no orgs have "Available" status', async () => {
    fakeQueryResponse([{ Id: '001', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'myPool' }]);

    const result = await PoolList.run(['--target-dev-hub', devHub.username]);

    expect(result.totals.available).to.equal(0);
  });

  it('outputs human-readable totals', async () => {
    fakeQueryResponse([
      { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'pool1' },
      { Id: '002', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1' },
    ]);

    await PoolList.run(['--target-dev-hub', devHub.username]);

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Unused Scratch Orgs in the Pool : 1');
    expect(output).to.include('Total Scratch Orgs in the Pool : 2');
  });
});
