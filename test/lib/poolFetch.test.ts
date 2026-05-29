import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import { queryOldestAvailableOrg, assignOrg, fetchPoolOrg } from '../../src/lib/poolFetch.js';
import type { FetchPoolDeps, AuthenticateResult } from '../../src/lib/poolFetch.js';

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

  describe('queryOldestAvailableOrg', () => {
    it('returns the oldest available org', async () => {
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
      const result = await queryOldestAvailableOrg(connection, 'myPool');

      expect(result).to.not.be.null;
      expect(result!.Id).to.equal('001');
      expect(result!.SignupUsername).to.equal('scratch1@example.com');
      expect(result!.Sfdx_Auth_Url__c).to.equal('force://PlatformCLI::token@test.salesforce.com');
    });

    it('returns null when no available orgs exist', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      const connection = await devHub.getConnection();
      const result = await queryOldestAvailableOrg(connection, 'emptyPool');

      expect(result).to.be.null;
    });

    it('throws PoolFetchQueryError on query failure', async () => {
      $$.fakeConnectionRequest = () => Promise.reject(new Error('Connection timeout'));

      const connection = await devHub.getConnection();
      try {
        await queryOldestAvailableOrg(connection, 'myPool');
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchQueryError');
      }
    });
  });

  describe('assignOrg', () => {
    it('updates org status to assigned', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({});

      const connection = await devHub.getConnection();
      await assignOrg(connection, '001');
    });

    it('throws PoolFetchAssignError on update failure', async () => {
      $$.fakeConnectionRequest = () => Promise.reject(new Error('Update failed'));

      const connection = await devHub.getConnection();
      try {
        await assignOrg(connection, '001');
        expect.fail('Expected error');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PoolFetchAssignError');
      }
    });
  });

  describe('fetchPoolOrg', () => {
    let queryStub: ReturnType<typeof $$.SANDBOX.stub>;
    let assignStub: ReturnType<typeof $$.SANDBOX.stub>;
    let authStub: ReturnType<typeof $$.SANDBOX.stub>;
    let setupStub: ReturnType<typeof $$.SANDBOX.stub>;
    let deps: FetchPoolDeps;

    beforeEach(() => {
      queryStub = $$.SANDBOX.stub();
      assignStub = $$.SANDBOX.stub().resolves();
      authStub = $$.SANDBOX.stub();
      setupStub = $$.SANDBOX.stub().resolves();

      deps = {
        queryOldestAvailableOrg: queryStub as unknown as FetchPoolDeps['queryOldestAvailableOrg'],
        assignOrg: assignStub as unknown as FetchPoolDeps['assignOrg'],
        authenticateToOrg: authStub as unknown as FetchPoolDeps['authenticateToOrg'],
        handlePostFetchSetup: setupStub as unknown as FetchPoolDeps['handlePostFetchSetup'],
      };
    });

    it('fetches the oldest available org and authenticates', async () => {
      queryStub.resolves({
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'user@scratch.org',
        CreatedDate: '2025-01-01T00:00:00.000Z',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      });
      const fakeAuthInfo = { getUsername: () => 'user@scratch.org' };
      authStub.resolves({ authInfo: fakeAuthInfo, instanceUrl: 'https://test.salesforce.com' } as AuthenticateResult);

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', undefined, false, deps);

      expect(result.username).to.equal('user@scratch.org');
      expect(result.orgId).to.equal('001');
      expect(result.poolTag).to.equal('devPool');
      expect(result.isDefault).to.be.false;
      expect(result.instanceUrl).to.equal('https://test.salesforce.com');
      expect(assignStub.calledOnce).to.be.true;
      expect(authStub.calledOnce).to.be.true;
    });

    it('throws when no available orgs exist', async () => {
      queryStub.resolves(null);

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
      queryStub.resolves({
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: null,
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      });

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
      queryStub.resolves({
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'user@scratch.org',
        Sfdx_Auth_Url__c: null,
      });

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
      queryStub.resolves({
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'user@scratch.org',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      });
      const fakeAuthInfo = { getUsername: () => 'user@scratch.org' };
      authStub.resolves({ authInfo: fakeAuthInfo, instanceUrl: 'https://test.salesforce.com' } as AuthenticateResult);

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', 'myAlias', false, deps);

      expect(result.alias).to.equal('myAlias');
      expect(setupStub.calledOnce).to.be.true;
      expect(setupStub.calledWith(fakeAuthInfo, 'myAlias', false)).to.be.true;
    });

    it('sets default when requested', async () => {
      queryStub.resolves({
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'user@scratch.org',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      });
      const fakeAuthInfo = { getUsername: () => 'user@scratch.org' };
      authStub.resolves({ authInfo: fakeAuthInfo, instanceUrl: 'https://test.salesforce.com' } as AuthenticateResult);

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', undefined, true, deps);

      expect(result.isDefault).to.be.true;
      expect(setupStub.calledOnce).to.be.true;
      expect(setupStub.calledWith(fakeAuthInfo, undefined, true)).to.be.true;
    });

    it('does not call handlePostFetchSetup when no alias or default', async () => {
      queryStub.resolves({
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'user@scratch.org',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      });
      const fakeAuthInfo = { getUsername: () => 'user@scratch.org' };
      authStub.resolves({ authInfo: fakeAuthInfo, instanceUrl: 'https://test.salesforce.com' } as AuthenticateResult);

      const connection = await devHub.getConnection();
      await fetchPoolOrg(connection, 'devPool', undefined, false, deps);

      expect(setupStub.called).to.be.false;
    });

    it('maps null Pool_tag__c to "undefined"', async () => {
      queryStub.resolves({
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: null,
        SignupUsername: 'user@scratch.org',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      });
      const fakeAuthInfo = { getUsername: () => 'user@scratch.org' };
      authStub.resolves({ authInfo: fakeAuthInfo, instanceUrl: 'https://test.salesforce.com' } as AuthenticateResult);

      const connection = await devHub.getConnection();
      const result = await fetchPoolOrg(connection, 'devPool', undefined, false, deps);

      expect(result.poolTag).to.equal('undefined');
    });
  });
});
/* eslint-enable camelcase */
