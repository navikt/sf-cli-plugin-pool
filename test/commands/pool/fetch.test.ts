import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { AuthInfo } from '@salesforce/core';
import PoolFetch from '../../../src/commands/pool/fetch.js';

/* eslint-disable camelcase */
describe('pool fetch', () => {
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

  type FetchOrgRecord = {
    Id: string;
    Pool_allocation_status__c: string;
    Pool_tag__c: string | null;
    SignupUsername: string;
    CreatedDate: string;
    Sfdx_Auth_Url__c: string | null;
  };

  function stubFetchFlow(records: FetchOrgRecord[]): void {
    $$.fakeConnectionRequest = (request: unknown) => {
      const req = request as { method?: string; url?: string };
      if (req.url?.includes('/query')) {
        return Promise.resolve({ totalSize: records.length, done: true, records });
      }
      return Promise.resolve({});
    };

    const fakeAuthInfo = {
      getUsername: () => records[0]?.SignupUsername ?? 'scratch@example.com',
      getFields: () => ({ instanceUrl: 'https://test.salesforce.com' }),
      save: $$.SANDBOX.stub().resolves(),
      handleAliasAndDefaultSettings: $$.SANDBOX.stub().resolves(),
    };

    $$.SANDBOX.stub(AuthInfo, 'parseSfdxAuthUrl').returns({
      clientId: 'PlatformCLI',
      clientSecret: '',
      refreshToken: 'refresh-token',
      loginUrl: 'https://login.salesforce.com',
    });

    const originalCreate = AuthInfo.create.bind(AuthInfo);
    $$.SANDBOX.stub(AuthInfo, 'create').callsFake(async (opts: unknown) => {
      const options = opts as { oauth2Options?: unknown; username?: string };
      if (options.oauth2Options) {
        return fakeAuthInfo as unknown as AuthInfo;
      }
      return originalCreate(opts as Parameters<typeof AuthInfo.create>[0]);
    });
  }

  it('fetches the oldest available org and returns result', async () => {
    stubFetchFlow([
      {
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'scratch@example.com',
        CreatedDate: '2025-01-01T00:00:00.000Z',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      },
    ]);

    const result = await PoolFetch.run(['--target-dev-hub', devHub.username, '--pool-tag', 'devPool']);

    expect(result.username).to.equal('scratch@example.com');
    expect(result.orgId).to.equal('001');
    expect(result.poolTag).to.equal('devPool');
    expect(result.isDefault).to.be.false;
  });

  it('throws error when no available orgs exist', async () => {
    $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

    try {
      await PoolFetch.run(['--target-dev-hub', devHub.username, '--pool-tag', 'emptyPool']);
      expect.fail('Expected an error');
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.include('No available scratch orgs');
    }
  });

  it('sets alias when --alias is provided', async () => {
    stubFetchFlow([
      {
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'scratch@example.com',
        CreatedDate: '2025-01-01T00:00:00.000Z',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      },
    ]);

    const result = await PoolFetch.run([
      '--target-dev-hub',
      devHub.username,
      '--pool-tag',
      'devPool',
      '--alias',
      'myScratch',
    ]);

    expect(result.alias).to.equal('myScratch');
  });

  it('sets default when --set-default is provided', async () => {
    stubFetchFlow([
      {
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'scratch@example.com',
        CreatedDate: '2025-01-01T00:00:00.000Z',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      },
    ]);

    const result = await PoolFetch.run(['--target-dev-hub', devHub.username, '--pool-tag', 'devPool', '--set-default']);

    expect(result.isDefault).to.be.true;
  });

  it('outputs human-readable messages when not --json', async () => {
    stubFetchFlow([
      {
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'scratch@example.com',
        CreatedDate: '2025-01-01T00:00:00.000Z',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      },
    ]);

    await PoolFetch.run(['--target-dev-hub', devHub.username, '--pool-tag', 'devPool']);

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include('Fetched scratch org scratch@example.com');
    expect(output).to.include('devPool');
  });

  it('shows alias and default messages when both flags set', async () => {
    stubFetchFlow([
      {
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'scratch@example.com',
        CreatedDate: '2025-01-01T00:00:00.000Z',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      },
    ]);

    await PoolFetch.run([
      '--target-dev-hub',
      devHub.username,
      '--pool-tag',
      'devPool',
      '--alias',
      'myScratch',
      '--set-default',
    ]);

    const output = sfCommandStubs.log
      .getCalls()
      .flatMap((c) => c.args)
      .join('\n');
    expect(output).to.include("Alias 'myScratch'");
    expect(output).to.include('set as default org');
  });

  it('throws error when org has no auth URL', async () => {
    $$.fakeConnectionRequest = (request: unknown) => {
      const req = request as { method?: string; url?: string };
      if (req.url?.includes('/query')) {
        return Promise.resolve({
          totalSize: 1,
          done: true,
          records: [
            {
              Id: '001',
              Pool_allocation_status__c: 'available',
              Pool_tag__c: 'devPool',
              SignupUsername: 'scratch@example.com',
              CreatedDate: '2025-01-01T00:00:00.000Z',
              Sfdx_Auth_Url__c: null,
            },
          ],
        });
      }
      return Promise.resolve({});
    };

    try {
      await PoolFetch.run(['--target-dev-hub', devHub.username, '--pool-tag', 'devPool']);
      expect.fail('Expected an error');
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
      expect((err as Error).message).to.include('no stored auth URL');
    }
  });

  it('requires --pool-tag flag', async () => {
    try {
      await PoolFetch.run(['--target-dev-hub', devHub.username]);
      expect.fail('Expected an error for missing required flag');
    } catch (err) {
      expect(err).to.be.instanceOf(Error);
    }
  });

  it('returns correct JSON structure', async () => {
    stubFetchFlow([
      {
        Id: '001',
        Pool_allocation_status__c: 'available',
        Pool_tag__c: 'devPool',
        SignupUsername: 'scratch@example.com',
        CreatedDate: '2025-01-01T00:00:00.000Z',
        Sfdx_Auth_Url__c: 'force://PlatformCLI::token@test.salesforce.com',
      },
    ]);

    const result = await PoolFetch.run(['--target-dev-hub', devHub.username, '--pool-tag', 'devPool']);

    expect(result).to.have.property('username').that.is.a('string');
    expect(result).to.have.property('orgId').that.is.a('string');
    expect(result).to.have.property('poolTag').that.is.a('string');
    expect(result).to.have.property('isDefault').that.is.a('boolean');
  });
});
/* eslint-enable camelcase */
