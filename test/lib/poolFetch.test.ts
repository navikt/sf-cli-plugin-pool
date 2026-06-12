import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import { queryAvailableOrgs, claimOrg, isContentionError, fetchPoolOrg } from '../../src/lib/poolFetch.js';
import type { FetchPoolDeps, AuthenticateResult } from '../../src/lib/poolFetch.js';
import type { ScratchOrgInfoRow } from '../../src/types/scratch-org-info.js';

/* eslint-disable camelcase */
describe('poolFetch', () => {
  const $$ = new TestContext();
  let devHub: MockTestOrgData;

  before(() => {
    process.setMaxListeners(20);
  });

  after(() => {
    process.setMaxListeners(10);
  });

  beforeEach(async () => {
    devHub = new MockTestOrgData();
    devHub.makeDevHub();
    await $$.stubAuths(devHub);
  });

  afterEach(() => {
    $$.restore();
  });

  describe('queryAvailableOrgs', () => {
    it('returns available orgs', async () => {
      $$.fakeConnectionRequest = () =>
        Promise.resolve({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '001',
              Pool_allocation_status__c: 'available',
              Pool_tag__c: 'myPool',
              SignupUsername: 'scratch1@example.com',
              CreatedDate: '2025-01-01T00:00:00.000Z',
              Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
            },
          ],
        });

      const connection = await devHub.getConnection();
      const result = await queryAvailableOrgs(connection, 'myPool');

      expect(result).to.have.length(1);
      expect(result[0].Id).to.equal('001');
      expect(result[0].SignupUsername).to.equal('scratch1@example.com');
      expect(result[0].Sfdx_Auth_Url__c).to.equal('force://PlatformCLI::token@test.salesforce.com');
    });

    it('returns an empty array when no available orgs exist', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      const connection = await devHub.getConnection();
      const result = await queryAvailableOrgs(connection, 'emptyPool');

      expect(result).to.deep.equal([]);
    });

    it('throws PoolFetchQueryError on query failure', async () => {
      $$.fakeConnectionRequest = () => Promise.reject(new Error('Connection timeout'));

      const connection = await devHub.getConnection();
      try {
        await queryAvailableOrgs(connection, 'myPool');
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchQueryError');
      }
    });
  });

  describe('isContentionError', () => {
    it('detects the validation-rule status code', () => {
      expect(isContentionError({ errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION' })).to.be.true;
      expect(isContentionError(new Error('FIELD_CUSTOM_VALIDATION_EXCEPTION: token already set'))).to.be.true;
    });

    it('returns false for unrelated errors', () => {
      expect(isContentionError(new Error('Connection reset'))).to.be.false;
      expect(isContentionError(null)).to.be.false;
    });
  });

  describe('claimOrg', () => {
    it('returns true when the claim succeeds', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ id: '001', success: true, errors: [] });

      const connection = await devHub.getConnection();
      const won = await claimOrg(connection, '001', 'token-1');
      expect(won).to.be.true;
    });

    it('returns false when a validation rule rejects the claim (thrown)', async () => {
      $$.fakeConnectionRequest = () =>
        Promise.reject(
          Object.assign(new Error('token already set'), { errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION' }),
        );

      const connection = await devHub.getConnection();
      const won = await claimOrg(connection, '001', 'token-1');
      expect(won).to.be.false;
    });

    it('returns false when the save result reports a validation rule rejection', async () => {
      $$.fakeConnectionRequest = () =>
        Promise.resolve({
          id: '001',
          success: false,
          errors: [{ statusCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'token already set' }],
        });

      const connection = await devHub.getConnection();
      const won = await claimOrg(connection, '001', 'token-1');
      expect(won).to.be.false;
    });

    it('throws PoolFetchAssignError on a non-contention failure', async () => {
      $$.fakeConnectionRequest = () => Promise.reject(new Error('Update failed'));

      const connection = await devHub.getConnection();
      try {
        await claimOrg(connection, '001', 'token-1');
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchAssignError');
      }
    });
  });

  describe('fetchPoolOrg', () => {
    let queryStub: ReturnType<typeof $$.SANDBOX.stub>;
    let claimStub: ReturnType<typeof $$.SANDBOX.stub>;
    let authStub: ReturnType<typeof $$.SANDBOX.stub>;
    let setupStub: ReturnType<typeof $$.SANDBOX.stub>;
    let sleepStub: ReturnType<typeof $$.SANDBOX.stub>;
    let deps: FetchPoolDeps;

    const org = (overrides: Partial<ScratchOrgInfoRow> = {}): ScratchOrgInfoRow => ({
      Id: '001',
      Pool_allocation_status__c: 'available',
      Pool_tag__c: 'devPool',
      SignupUsername: 'user@scratch.org',
      CreatedDate: '2025-01-01T00:00:00.000Z',
      Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      ...overrides,
    });

    beforeEach(() => {
      queryStub = $$.SANDBOX.stub();
      claimStub = $$.SANDBOX.stub().resolves(true);
      authStub = $$.SANDBOX.stub();
      setupStub = $$.SANDBOX.stub().resolves();
      sleepStub = $$.SANDBOX.stub().resolves();

      deps = {
        queryAvailableOrgs: queryStub as unknown as FetchPoolDeps['queryAvailableOrgs'],
        claimOrg: claimStub as unknown as FetchPoolDeps['claimOrg'],
        authenticateToOrg: authStub as unknown as FetchPoolDeps['authenticateToOrg'],
        handlePostFetchSetup: setupStub as unknown as FetchPoolDeps['handlePostFetchSetup'],
        generateToken: () => 'fixed-token',
        sleep: sleepStub as unknown as FetchPoolDeps['sleep'],
      };
    });

    function stubAuthSuccess(username = 'user@scratch.org'): void {
      const fakeAuthInfo = { getUsername: () => username };
      authStub.resolves({ authInfo: fakeAuthInfo, instanceUrl: 'https://test.salesforce.com' } as AuthenticateResult);
    }

    it('claims an available org and authenticates', async () => {
      queryStub.resolves([org()]);
      stubAuthSuccess();

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', undefined, false, deps);

      expect(result.username).to.equal('user@scratch.org');
      expect(result.orgId).to.equal('001');
      expect(result.poolTag).to.equal('devPool');
      expect(result.isDefault).to.be.false;
      expect(result.instanceUrl).to.equal('https://test.salesforce.com');
      expect(claimStub.calledOnceWith(connection, '001', 'fixed-token')).to.be.true;
      expect(authStub.calledOnce).to.be.true;
    });

    it('moves to the next candidate when a claim is lost, then wins', async () => {
      queryStub.resolves([org({ Id: '001' }), org({ Id: '002', SignupUsername: 'second@scratch.org' })]);
      claimStub.withArgs($$.SANDBOX.match.any, '001').resolves(false);
      claimStub.withArgs($$.SANDBOX.match.any, '002').resolves(true);
      stubAuthSuccess('second@scratch.org');

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', undefined, false, deps);

      expect(result.orgId).to.equal('002');
      expect(result.username).to.equal('second@scratch.org');
    });

    it('throws PoolFetchContentionError when every claim is lost', async () => {
      queryStub.resolves([org({ Id: '001' }), org({ Id: '002' })]);
      claimStub.resolves(false);

      const connection = await devHub.getConnection();
      try {
        await fetchPoolOrg(connection, 'devPool', undefined, false, deps);
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchContentionError');
      }
      expect(sleepStub.called).to.be.true;
      expect(authStub.called).to.be.false;
    });

    it('throws when no available orgs exist', async () => {
      queryStub.resolves([]);

      const connection = await devHub.getConnection();
      try {
        await fetchPoolOrg(connection, 'emptyPool', undefined, false, deps);
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchNoOrgsAvailableError');
      }
    });

    it('throws when org has no SignupUsername', async () => {
      queryStub.resolves([org({ SignupUsername: null })]);

      const connection = await devHub.getConnection();
      try {
        await fetchPoolOrg(connection, 'devPool', undefined, false, deps);
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchNoUsernameError');
      }
    });

    it('throws when org has no stored auth URL', async () => {
      queryStub.resolves([org({ Sfdx_Auth_Url__c: null })]);

      const connection = await devHub.getConnection();
      try {
        await fetchPoolOrg(connection, 'devPool', undefined, false, deps);
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchNoAuthUrlError');
      }
    });

    it('sets alias when provided', async () => {
      queryStub.resolves([org()]);
      stubAuthSuccess();

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', 'myAlias', false, deps);

      expect(result.alias).to.equal('myAlias');
      expect(setupStub.calledOnce).to.be.true;
      expect(setupStub.calledWith($$.SANDBOX.match.any, 'myAlias', false)).to.be.true;
    });

    it('sets default when requested', async () => {
      queryStub.resolves([org()]);
      stubAuthSuccess();

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', undefined, true, deps);

      expect(result.isDefault).to.be.true;
      expect(setupStub.calledOnce).to.be.true;
      expect(setupStub.calledWith($$.SANDBOX.match.any, undefined, true)).to.be.true;
    });

    it('does not call handlePostFetchSetup when no alias or default', async () => {
      queryStub.resolves([org()]);
      stubAuthSuccess();

      const connection = await devHub.getConnection();
      await fetchPoolOrg(connection, 'devPool', undefined, false, deps);

      expect(setupStub.called).to.be.false;
    });

    it('maps null Pool_tag__c to "undefined"', async () => {
      queryStub.resolves([org({ Pool_tag__c: null })]);
      stubAuthSuccess();

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', undefined, false, deps);

      expect(result.poolTag).to.equal('undefined');
    });
  });
});
/* eslint-enable camelcase */
