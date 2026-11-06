import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx, stubSpinner } from '@salesforce/sf-plugins-core';
import { AuthRemover, ConfigAggregator, SfError, StateAggregator } from '@salesforce/core';
import PoolReturn from '../../../src/commands/pool/return.js';

describe('pool return', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let spinnerStubs: ReturnType<typeof stubSpinner>;
  let devHub: MockTestOrgData;
  let scratch: MockTestOrgData;
  let compositeBodies: Array<{ compositeRequest: Array<{ body: Record<string, unknown> }> }>;

  before(() => {
    process.setMaxListeners(20);
  });

  after(() => {
    process.setMaxListeners(10);
  });

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    spinnerStubs = stubSpinner($$.SANDBOX);
    devHub = new MockTestOrgData();
    devHub.makeDevHub();
    scratch = new MockTestOrgData();
    scratch.orgId = '00D000000000001AAA';
    scratch.clientId = 'PlatformCLI';
    scratch.refreshToken = '5Aep861refresh.token';
    scratch.createDevHubUsername(devHub.username);
    await $$.stubAuths(devHub, scratch);
    stubDevHub();
  });

  afterEach(() => {
    $$.restore();
  });

  function stubDevHub(allocationStatus = 'assigned'): void {
    compositeBodies = [];
    $$.fakeConnectionRequest = (request: unknown) => {
      const req = request as { url?: string; body?: string };
      if (req.url?.includes('/query')) {
        return Promise.resolve({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '0Xs000000000001AAA',
              ScratchOrg: '00D000000000001',
              OwnerId: devHub.userId,
              CreatedById: '005000000000003AAA',
              ScratchOrgInfo: {
                Id: '2SR000000000001AAA',
                SignupUsername: scratch.username,
                Status: 'Active',
                Pool_tag__c: 'devPool',
                Pool_allocation_status__c: allocationStatus,
                OwnerId: devHub.userId,
                CreatedById: '005000000000002AAA',
                LastModifiedDate: '2025-01-01T12:34:56.000+0000',
              },
            },
          ],
        });
      }
      if (req.url?.endsWith('/composite')) {
        compositeBodies.push(JSON.parse(req.body ?? '{}'));
        return Promise.resolve({
          compositeResponse: [
            { referenceId: 'scratchOrgInfo', httpStatusCode: 204, body: null },
            { referenceId: 'activeScratchOrg', httpStatusCode: 204, body: null },
          ],
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${req.url}`));
    };
  }

  async function loadAliases(): Promise<StateAggregator> {
    StateAggregator.clearInstance();
    return StateAggregator.getInstance();
  }

  it('returns an org selected by alias and removes its local auth and alias', async () => {
    $$.stubAliases({ myScratch: scratch.username });

    const result = await PoolReturn.run(['--target-org', 'myScratch', '--target-dev-hub', devHub.username]);

    expect(result).to.include({
      username: scratch.username,
      orgId: '2SR000000000001AAA',
      poolTag: 'devPool',
      scratchOrgInfoOwnerId: '005000000000002AAA',
      activeScratchOrgOwnerId: '005000000000003AAA',
      status: 'available',
      localAuthRemoved: true,
    });
    expect(compositeBodies).to.have.lengthOf(1);
    expect(compositeBodies[0].compositeRequest[0].body.Sfdx_Auth_Url__c).to.equal(
      `force://PlatformCLI::5Aep861refresh.token@${new URL(scratch.instanceUrl).host}`,
    );
    expect((await loadAliases()).aliases.get(scratch.username)).not.to.exist;
    expect($$.stubs.configRemove?.calledWith(scratch.username)).to.be.true;
    const output = sfCommandStubs.log.getCalls().flatMap((call) => call.args);
    expect(output).to.include(`Returned scratch org ${scratch.username} to pool 'devPool'.`);
    expect(spinnerStubs.stop.calledWith('Done')).to.be.true;
  });

  it('uses the default org and Dev Hub and clears the default-org setting', async () => {
    await $$.stubConfig({ 'target-org': scratch.username, 'target-dev-hub': devHub.username });

    const result = await PoolReturn.run([]);

    expect(result.username).to.equal(scratch.username);
    const config = (await ConfigAggregator.create()).getConfig();
    expect(config['target-org']).to.be.undefined;
    expect(config['target-dev-hub']).to.equal(devHub.username);
  });

  it('returns JSON and warns when local auth cleanup fails', async () => {
    $$.SANDBOX.stub(AuthRemover.prototype, 'removeAuth').rejects(new Error('permission denied'));

    const result = await PoolReturn.run([
      '--target-org',
      scratch.username,
      '--target-dev-hub',
      devHub.username,
      '--json',
    ]);

    expect(result.status).to.equal('available');
    expect(result.localAuthRemoved).to.be.false;
    expect(result.warnings).to.have.lengthOf(1);
    expect(sfCommandStubs.warn.calledOnceWith(result.warnings[0])).to.be.true;
    expect(sfCommandStubs.log.notCalled).to.be.true;
  });

  it('stops the spinner and keeps local auth when the org cannot be returned', async () => {
    $$.stubAliases({ myScratch: scratch.username });
    stubDevHub('available');

    try {
      await PoolReturn.run(['--target-org', 'myScratch', '--target-dev-hub', devHub.username]);
      expect.fail('Expected an error');
    } catch (err) {
      expect(err).to.be.instanceOf(SfError);
      expect((err as SfError).name).to.equal('PoolReturnNotAssignedError');
    }

    expect(compositeBodies).to.be.empty;
    expect(spinnerStubs.stop.calledWith('Failed')).to.be.true;
    expect((await loadAliases()).aliases.get(scratch.username)).to.equal('myScratch');
  });
});
