import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Org } from '@salesforce/core';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import PoolClean from '../../../src/commands/pool/clean.js';

/* eslint-disable camelcase */
describe('pool clean', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let devHub: MockTestOrgData;

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

  type OrgRecord = {
    Id: string;
    Pool_allocation_status__c: string;
    Pool_tag__c: string | null;
    SignupUsername: string;
  };

  function fakeCleanRequests(
    records: OrgRecord[],
    deleteResults?: Map<string, { success: boolean; error?: string }>
  ): void {
    $$.fakeConnectionRequest = (request: unknown) => {
      const req = request as { method?: string; url?: string };
      if (req.url?.includes('/query')) {
        return Promise.resolve({ totalSize: records.length, done: true, records });
      }
      return Promise.resolve({});
    };

    const originalCreate = Org.create.bind(Org);
    $$.SANDBOX.stub(Org, 'create').callsFake(async (opts: unknown) => {
      const options = opts as { aliasOrUsername?: string };
      const matchesRecord =
        options.aliasOrUsername && records.some((r) => r.SignupUsername === options.aliasOrUsername);
      if (matchesRecord) {
        const orgId = records.find((r) => r.SignupUsername === options.aliasOrUsername)?.Id;
        const result = deleteResults?.get(orgId ?? '');
        return {
          delete: async () => {
            if (result && !result.success) {
              throw new Error(result.error ?? 'Delete failed');
            }
          },
        } as unknown as Org;
      }
      return originalCreate(opts as Parameters<typeof Org.create>[0]);
    });
  }

  it('returns empty result when no orgs found', async () => {
    fakeCleanRequests([]);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username]);

    expect(result.orgs).to.deep.equal([]);
    expect(result.summary).to.deep.equal({ deleted: 0, failed: 0, total: 0 });
  });

  it('logs no-orgs message when no orgs found', async () => {
    fakeCleanRequests([]);

    await PoolClean.run(['--target-dev-hub', devHub.username]);

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('No scratch orgs found matching the specified criteria.');
  });

  it('deletes failed orgs by default (no --status flag)', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'failed', Pool_tag__c: 'myPool', SignupUsername: 'scratch1@example.com' },
      { Id: '002', Pool_allocation_status__c: 'failed', Pool_tag__c: 'myPool', SignupUsername: 'scratch2@example.com' },
    ];
    fakeCleanRequests(records);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username]);

    expect(result.summary.deleted).to.equal(2);
    expect(result.summary.failed).to.equal(0);
    expect(result.summary.total).to.equal(2);
    expect(result.orgs).to.have.lengthOf(2);
    expect(result.orgs[0].deletionResult).to.equal('deleted');
    expect(result.orgs[1].deletionResult).to.equal('deleted');
  });

  it('filters by --pool-tag', async () => {
    const records: OrgRecord[] = [
      {
        Id: '001',
        Pool_allocation_status__c: 'failed',
        Pool_tag__c: 'targetPool',
        SignupUsername: 'scratch1@example.com',
      },
    ];
    fakeCleanRequests(records);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username, '--pool-tag', 'targetPool']);

    expect(result.orgs).to.have.lengthOf(1);
    expect(result.orgs[0].poolTag).to.equal('targetPool');
    expect(result.summary.deleted).to.equal(1);
  });

  it('filters by --status', async () => {
    const records: OrgRecord[] = [
      {
        Id: '001',
        Pool_allocation_status__c: 'Available',
        Pool_tag__c: 'pool1',
        SignupUsername: 'scratch1@example.com',
      },
    ];
    fakeCleanRequests(records);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username, '--status', 'Available']);

    expect(result.orgs).to.have.lengthOf(1);
    expect(result.orgs[0].status).to.equal('Available');
    expect(result.summary.deleted).to.equal(1);
  });

  it('--all targets all statuses including In Use (with --no-prompt)', async () => {
    const records: OrgRecord[] = [
      {
        Id: '001',
        Pool_allocation_status__c: 'Available',
        Pool_tag__c: 'pool1',
        SignupUsername: 'scratch1@example.com',
      },
      { Id: '002', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1', SignupUsername: 'scratch2@example.com' },
      { Id: '003', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch3@example.com' },
    ];
    fakeCleanRequests(records);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username, '--all', '--no-prompt']);

    expect(result.summary.deleted).to.equal(3);
    expect(result.summary.total).to.equal(3);
  });

  it('--all and --status are mutually exclusive', async () => {
    fakeCleanRequests([]);

    try {
      await PoolClean.run(['--target-dev-hub', devHub.username, '--all', '--status', 'failed']);
      expect.fail('Expected an error for mutually exclusive flags');
    } catch (err) {
      // oclif throws an error when exclusive flags are used together
      expect(err).to.be.instanceOf(Error);
    }
  });

  it('prompts for confirmation when In Use orgs exist and user confirms', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
      { Id: '002', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch2@example.com' },
    ];
    fakeCleanRequests(records);
    $$.SANDBOX.stub(PoolClean.prototype, 'confirm').resolves(true);

    const result = await PoolClean.run([
      '--target-dev-hub',
      devHub.username,
      '--status',
      'In Use',
      '--status',
      'failed',
    ]);

    expect(result.summary.deleted).to.equal(2);
    expect(result.summary.total).to.equal(2);
  });

  it('aborts when user declines confirmation for In Use orgs', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
    ];
    fakeCleanRequests(records);
    $$.SANDBOX.stub(PoolClean.prototype, 'confirm').resolves(false);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username, '--status', 'In Use']);

    expect(result.orgs).to.deep.equal([]);
    expect(result.summary).to.deep.equal({ deleted: 0, failed: 0, total: 0 });
  });

  it('logs declined message when user aborts', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
    ];
    fakeCleanRequests(records);
    $$.SANDBOX.stub(PoolClean.prototype, 'confirm').resolves(false);

    await PoolClean.run(['--target-dev-hub', devHub.username, '--status', 'In Use']);

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Aborted');
  });

  it('--no-prompt skips confirmation even with In Use orgs', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
    ];
    fakeCleanRequests(records);
    const confirmStub = $$.SANDBOX.stub(PoolClean.prototype, 'confirm').resolves(true);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username, '--status', 'In Use', '--no-prompt']);

    expect(confirmStub.called).to.be.false;
    expect(result.summary.deleted).to.equal(1);
  });

  it('does not prompt when no In Use orgs exist', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
    ];
    fakeCleanRequests(records);
    const confirmStub = $$.SANDBOX.stub(PoolClean.prototype, 'confirm').resolves(true);

    await PoolClean.run(['--target-dev-hub', devHub.username]);

    expect(confirmStub.called).to.be.false;
  });

  it('handles partial deletion failures', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
      { Id: '002', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch2@example.com' },
    ];
    const deleteResults = new Map<string, { success: boolean; error?: string }>([
      ['001', { success: true }],
      ['002', { success: false, error: 'Insufficient permissions' }],
    ]);
    fakeCleanRequests(records, deleteResults);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username]);

    expect(result.summary.deleted).to.equal(1);
    expect(result.summary.failed).to.equal(1);
    expect(result.summary.total).to.equal(2);
    const failedOrg = result.orgs.find((o) => o.deletionResult === 'failed');
    expect(failedOrg).to.not.be.undefined;
    expect(failedOrg!.error).to.include('Insufficient permissions');
  });

  it('returns correct JSON structure with orgs array and summary', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
    ];
    fakeCleanRequests(records);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username]);

    expect(result).to.have.property('orgs').that.is.an('array');
    expect(result).to.have.property('summary');
    expect(result.summary).to.have.all.keys('deleted', 'failed', 'total');
    expect(result.orgs[0]).to.have.all.keys('scratchOrgId', 'poolTag', 'status', 'deletionResult');
  });

  it('outputs human-readable summary', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch1@example.com' },
      { Id: '002', Pool_allocation_status__c: 'failed', Pool_tag__c: 'pool1', SignupUsername: 'scratch2@example.com' },
    ];
    fakeCleanRequests(records);

    await PoolClean.run(['--target-dev-hub', devHub.username]);

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Found 2 scratch org(s) to delete.');
    expect(output).to.include('Deleted: 2');
    expect(output).to.include('Failed: 0');
    expect(output).to.include('Total: 2');
  });

  it('maps null Pool_tag__c to "undefined" in results', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'failed', Pool_tag__c: null, SignupUsername: 'scratch1@example.com' },
    ];
    fakeCleanRequests(records);

    const result = await PoolClean.run(['--target-dev-hub', devHub.username]);

    expect(result.orgs[0].poolTag).to.equal('undefined');
  });

  it('supports multiple --pool-tag values', async () => {
    const records: OrgRecord[] = [
      { Id: '001', Pool_allocation_status__c: 'failed', Pool_tag__c: 'poolA', SignupUsername: 'scratch1@example.com' },
      { Id: '002', Pool_allocation_status__c: 'failed', Pool_tag__c: 'poolB', SignupUsername: 'scratch2@example.com' },
    ];
    fakeCleanRequests(records);

    const result = await PoolClean.run([
      '--target-dev-hub',
      devHub.username,
      '--pool-tag',
      'poolA',
      '--pool-tag',
      'poolB',
    ]);

    expect(result.summary.deleted).to.equal(2);
    expect(result.orgs.map((o) => o.poolTag)).to.include.members(['poolA', 'poolB']);
  });
});
/* eslint-enable camelcase */
