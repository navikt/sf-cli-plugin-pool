import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Connection, Org, SfError } from '@salesforce/core';
import { queryReturnOrg, returnPoolOrg, submitReturnTransaction } from '../../src/lib/poolReturn.js';
import type { ReturnPoolDeps, ReturnUpdate } from '../../src/lib/poolReturn.js';
import type { ReturnOrgRow } from '../../src/types/scratch-org-info.js';

describe('poolReturn', () => {
  const $$ = new TestContext();
  let devHub: MockTestOrgData;
  let connection: Connection;

  const SCRATCH_ORG_ID = '00D000000000001AAA';
  const USERNAME = 'scratch@example.com';
  const RUNNING_USER_ID = '005000000000001AAA';
  const INFO_CREATOR_ID = '005000000000002AAA';
  const ACTIVE_CREATOR_ID = '005000000000003AAA';
  const AUTH_URL = 'force://PlatformCLI::5Aep861refresh.token@scratch.my.salesforce.com';
  const CLAIM_TOKEN = 'claim-token-1';

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
    connection = await devHub.getConnection();
  });

  afterEach(() => {
    $$.restore();
  });

  type AnyJson = Awaited<ReturnType<typeof $$.fakeConnectionRequest>>;
  type JsonMap = Record<string, AnyJson>;
  type InfoOverrides = Partial<NonNullable<ReturnOrgRow['ScratchOrgInfo']>>;

  const row = (overrides: Partial<ReturnOrgRow> = {}, infoOverrides: InfoOverrides = {}): ReturnOrgRow => ({
    Id: '0Xs000000000001AAA',
    ScratchOrg: '00D000000000001',
    OwnerId: RUNNING_USER_ID,
    CreatedById: ACTIVE_CREATOR_ID,
    ScratchOrgInfo: {
      Id: '2SR000000000001AAA',
      SignupUsername: USERNAME,
      Status: 'Active',
      Pool_tag__c: 'devPool',
      Pool_allocation_status__c: 'assigned',
      OwnerId: RUNNING_USER_ID,
      CreatedById: INFO_CREATOR_ID,
      Pool_claim_token__c: CLAIM_TOKEN,
      ...infoOverrides,
    },
    ...overrides,
  });

  const update: ReturnUpdate = {
    username: USERNAME,
    scratchOrgInfoId: '2SR000000000001AAA',
    scratchOrgInfoOwnerId: INFO_CREATOR_ID,
    activeScratchOrgId: '0Xs000000000001AAA',
    activeScratchOrgOwnerId: ACTIVE_CREATOR_ID,
    sfdxAuthUrl: AUTH_URL,
    claimToken: CLAIM_TOKEN,
  };

  async function expectRejection(promise: Promise<unknown>, name: string): Promise<SfError> {
    try {
      await promise;
    } catch (err) {
      expect(err).to.be.instanceOf(SfError);
      expect((err as SfError).name).to.equal(name);
      return err as SfError;
    }
    return expect.fail(`Expected ${name}`);
  }

  describe('queryReturnOrg', () => {
    it('queries by the 15-character org Id and keeps only exact-case matches', async () => {
      let requestedUrl = '';
      $$.fakeConnectionRequest = (request: unknown) => {
        requestedUrl = decodeURIComponent((request as { url: string }).url);
        return Promise.resolve({
          totalSize: 2,
          done: true,
          records: [row(), row({ Id: '0Xs000000000002AAA', ScratchOrg: '00d000000000001' })],
        });
      };

      const result = await queryReturnOrg(connection, SCRATCH_ORG_ID);

      expect(requestedUrl).to.include("WHERE ScratchOrg = '00D000000000001'");
      expect(result.map((record) => record.Id)).to.deep.equal(['0Xs000000000001AAA']);
    });

    it('rejects a malformed org Id without querying', async () => {
      let queried = false;
      $$.fakeConnectionRequest = () => {
        queried = true;
        return Promise.resolve({ totalSize: 0, done: true, records: [] });
      };

      await expectRejection(queryReturnOrg(connection, "00D' OR Id != '"), 'PoolReturnQueryError');
      expect(queried).to.be.false;
    });

    it('throws PoolReturnQueryError on query failure', async () => {
      $$.fakeConnectionRequest = () => Promise.reject(new Error('Connection timeout'));

      const err = await expectRejection(queryReturnOrg(connection, SCRATCH_ORG_ID), 'PoolReturnQueryError');
      expect(err.message).to.include('Connection timeout');
    });
  });

  describe('submitReturnTransaction', () => {
    function respondWith(response: AnyJson | Error): Array<{ method?: string; url?: string; body?: string }> {
      const requests: Array<{ method?: string; url?: string; body?: string }> = [];
      $$.fakeConnectionRequest = (request: unknown) => {
        requests.push(request as { method?: string; url?: string; body?: string });
        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
      };
      return requests;
    }

    const subresponses = (claimCheck: JsonMap, scratchOrgInfo: JsonMap, activeScratchOrg: JsonMap): AnyJson => ({
      compositeResponse: [
        { referenceId: 'claimCheck', ...claimCheck },
        { referenceId: 'scratchOrgInfo', ...scratchOrgInfo },
        { referenceId: 'activeScratchOrg', ...activeScratchOrg },
      ],
    });

    const halted: JsonMap = {
      httpStatusCode: 400,
      body: [{ errorCode: 'PROCESSING_HALTED', message: 'rolled back' }],
    };

    it('sends one all-or-none Composite request that re-checks the claim token before updating', async () => {
      const requests = respondWith(
        subresponses({ httpStatusCode: 204 }, { httpStatusCode: 204 }, { httpStatusCode: 204 }),
      );

      await submitReturnTransaction(connection, update);

      expect(requests).to.have.lengthOf(1);
      expect(requests[0].method).to.equal('POST');
      expect(requests[0].url).to.match(/\/services\/data\/v[\d.]+\/composite$/);
      const body = JSON.parse(requests[0].body ?? '{}');
      expect(body.allOrNone).to.be.true;
      expect(body.compositeRequest).to.have.lengthOf(3);
      const [claimCheck, scratchOrgInfo, activeScratchOrg] = body.compositeRequest;
      expect(claimCheck.method).to.equal('PATCH');
      expect(claimCheck.url).to.match(/\/sobjects\/ScratchOrgInfo\/2SR000000000001AAA$/);
      expect(claimCheck.body).to.deep.equal({ Pool_claim_token__c: CLAIM_TOKEN });
      expect(scratchOrgInfo.method).to.equal('PATCH');
      expect(scratchOrgInfo.url).to.equal(claimCheck.url);
      expect(scratchOrgInfo.body).to.deep.equal({
        OwnerId: INFO_CREATOR_ID,
        Sfdx_Auth_Url__c: AUTH_URL,
        Pool_claim_token__c: null,
        Pool_allocation_status__c: 'available',
      });
      expect(activeScratchOrg.method).to.equal('PATCH');
      expect(activeScratchOrg.url).to.match(/\/sobjects\/ActiveScratchOrg\/0Xs000000000001AAA$/);
      expect(activeScratchOrg.body).to.deep.equal({ OwnerId: ACTIVE_CREATOR_ID });
    });

    it('throws PoolReturnStaleError when the claim-token check is rejected', async () => {
      respondWith(
        subresponses(
          { httpStatusCode: 400, body: [{ errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'claimed' }] },
          halted,
          halted,
        ),
      );

      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnStaleError');
    });

    it('throws a redacted PoolReturnUpdateError when a subrequest fails', async () => {
      respondWith(
        subresponses(halted, halted, {
          httpStatusCode: 400,
          body: [{ errorCode: 'FIELD_INTEGRITY_EXCEPTION', message: `bad ${AUTH_URL} ${CLAIM_TOKEN}` }],
        }),
      );

      const err = await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUpdateError');
      expect(err.message).to.include('FIELD_INTEGRITY_EXCEPTION');
      expect(err.message).not.to.include('PROCESSING_HALTED');
      expect(err.message).not.to.include('5Aep861refresh.token');
      expect(err.message).not.to.include(CLAIM_TOKEN);
    });

    it('does not treat a validation failure outside the claim-token check as a stale return', async () => {
      respondWith(
        subresponses(
          halted,
          {
            httpStatusCode: 400,
            body: [{ errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: 'another rule' }],
          },
          halted,
        ),
      );

      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUpdateError');
    });

    it('throws PoolReturnUpdateError when the Dev Hub rejects the request', async () => {
      respondWith(Object.assign(new Error('Session expired'), { errorCode: 'INVALID_SESSION_ID' }));

      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUpdateError');

      respondWith(Object.assign(new Error('Bad Request'), { errorCode: 'ERROR_HTTP_400' }));
      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUpdateError');
    });

    it('throws PoolReturnUncertainError when the outcome is unknown', async () => {
      respondWith(new Error('fetch failed'));
      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUncertainError');

      respondWith(Object.assign(new Error('Gateway Timeout'), { errorCode: 'ERROR_HTTP_504' }));
      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUncertainError');

      respondWith(Object.assign(new Error('An unexpected error occurred'), { errorCode: 'UNKNOWN_EXCEPTION' }));
      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUncertainError');

      respondWith({});
      await expectRejection(submitReturnTransaction(connection, update), 'PoolReturnUncertainError');
    });
  });

  describe('returnPoolOrg', () => {
    let userIdStub: ReturnType<typeof $$.SANDBOX.stub>;
    let queryStub: ReturnType<typeof $$.SANDBOX.stub>;
    let authUrlStub: ReturnType<typeof $$.SANDBOX.stub>;
    let submitStub: ReturnType<typeof $$.SANDBOX.stub>;
    let removeStub: ReturnType<typeof $$.SANDBOX.stub>;
    let deps: ReturnPoolDeps;

    const scratchOrg = { getOrgId: () => SCRATCH_ORG_ID, getUsername: () => USERNAME } as unknown as Org;

    beforeEach(() => {
      userIdStub = $$.SANDBOX.stub().resolves(RUNNING_USER_ID);
      queryStub = $$.SANDBOX.stub().resolves([row()]);
      authUrlStub = $$.SANDBOX.stub().returns(AUTH_URL);
      submitStub = $$.SANDBOX.stub().resolves();
      removeStub = $$.SANDBOX.stub().resolves();

      deps = {
        getRunningUserId: userIdStub as unknown as ReturnPoolDeps['getRunningUserId'],
        queryReturnOrg: queryStub as unknown as ReturnPoolDeps['queryReturnOrg'],
        getSfdxAuthUrl: authUrlStub as unknown as ReturnPoolDeps['getSfdxAuthUrl'],
        submitReturnTransaction: submitStub as unknown as ReturnPoolDeps['submitReturnTransaction'],
        removeLocalAuth: removeStub as unknown as ReturnPoolDeps['removeLocalAuth'],
      };
    });

    function expectNoChanges(): void {
      expect(submitStub.notCalled).to.be.true;
      expect(removeStub.notCalled).to.be.true;
    }

    it('restores each record to its creator, then removes local auth', async () => {
      const result = await returnPoolOrg(connection, scratchOrg, deps);

      expect(queryStub.calledOnceWith(connection, SCRATCH_ORG_ID)).to.be.true;
      expect(submitStub.calledOnceWithExactly(connection, update)).to.be.true;
      expect(removeStub.calledOnceWithExactly(USERNAME)).to.be.true;
      expect(submitStub.calledBefore(removeStub)).to.be.true;
      expect(result).to.deep.equal({
        username: USERNAME,
        orgId: '2SR000000000001AAA',
        activeScratchOrgId: '0Xs000000000001AAA',
        poolTag: 'devPool',
        scratchOrgInfoOwnerId: INFO_CREATOR_ID,
        activeScratchOrgOwnerId: ACTIVE_CREATOR_ID,
        status: 'available',
        localAuthRemoved: true,
        warnings: [],
      });
    });

    it('matches owner Ids across 15/18 characters and the signup username case-insensitively', async () => {
      queryStub.resolves([
        row({ OwnerId: '005000000000001' }, { OwnerId: '005000000000001', SignupUsername: 'Scratch@Example.com' }),
      ]);

      await returnPoolOrg(connection, scratchOrg, deps);

      expect(submitStub.calledOnce).to.be.true;
    });

    const rejections: Array<{ title: string; rows: ReturnOrgRow[]; name: string }> = [
      { title: 'the org is not in the Dev Hub', rows: [], name: 'PoolReturnNotFoundError' },
      { title: 'the org matches several records', rows: [row(), row()], name: 'PoolReturnMultipleRecordsError' },
      { title: 'the parent record is missing', rows: [row({ ScratchOrgInfo: null })], name: 'PoolReturnNotFoundError' },
      { title: 'the org is not active', rows: [row({}, { Status: 'Deleted' })], name: 'PoolReturnNotActiveError' },
      { title: 'the org has no pool tag', rows: [row({}, { Pool_tag__c: null })], name: 'PoolReturnNotPoolOrgError' },
      {
        title: 'the org is not assigned',
        rows: [row({}, { Pool_allocation_status__c: 'available' })],
        name: 'PoolReturnNotAssignedError',
      },
      {
        title: 'another user owns the ScratchOrgInfo',
        rows: [row({}, { OwnerId: '005000000000009AAA' })],
        name: 'PoolReturnNotOwnerError',
      },
      {
        title: 'another user owns the ActiveScratchOrg',
        rows: [row({ OwnerId: '005000000000009AAA' })],
        name: 'PoolReturnNotOwnerError',
      },
      {
        title: 'the ScratchOrgInfo creator is unknown',
        rows: [row({}, { CreatedById: null })],
        name: 'PoolReturnMissingCreatorError',
      },
      {
        title: 'the ActiveScratchOrg creator is unknown',
        rows: [row({ CreatedById: null })],
        name: 'PoolReturnMissingCreatorError',
      },
      {
        title: 'the local user is not the signup user',
        rows: [row({}, { SignupUsername: 'other@example.com' })],
        name: 'PoolReturnUsernameMismatchError',
      },
      {
        title: 'the org has no claim token',
        rows: [row({}, { Pool_claim_token__c: null })],
        name: 'PoolReturnMissingClaimTokenError',
      },
    ];

    for (const { title, rows, name } of rejections) {
      it(`rejects without changes when ${title}`, async () => {
        queryStub.resolves(rows);

        await expectRejection(returnPoolOrg(connection, scratchOrg, deps), name);
        expectNoChanges();
      });
    }

    it('rejects without changes when no reusable auth URL is available', async () => {
      authUrlStub.throws(new Error('undefined refreshToken'));
      await expectRejection(returnPoolOrg(connection, scratchOrg, deps), 'PoolReturnAuthUrlError');

      authUrlStub.returns('force://:token@host');
      await expectRejection(returnPoolOrg(connection, scratchOrg, deps), 'PoolReturnAuthUrlError');
      expectNoChanges();
    });

    it('throws PoolReturnUserIdError when the Dev Hub user cannot be resolved', async () => {
      userIdStub.rejects(new Error('identity failed'));

      await expectRejection(returnPoolOrg(connection, scratchOrg, deps), 'PoolReturnUserIdError');
      expect(queryStub.notCalled).to.be.true;
      expectNoChanges();
    });

    it('keeps local auth when the transaction fails', async () => {
      submitStub.rejects(new SfError('stale', 'PoolReturnStaleError'));

      await expectRejection(returnPoolOrg(connection, scratchOrg, deps), 'PoolReturnStaleError');
      expect(removeStub.notCalled).to.be.true;
    });

    it('reports an uncertain outcome for HTTP 408 without retrying or removing local auth', async () => {
      const requestStub = $$.SANDBOX.stub().rejects(
        Object.assign(new Error('Request Timeout'), { errorCode: 'ERROR_HTTP_408' }),
      );
      $$.fakeConnectionRequest = requestStub;
      deps.submitReturnTransaction = submitReturnTransaction;

      const err = await expectRejection(returnPoolOrg(connection, scratchOrg, deps), 'PoolReturnUncertainError');

      expect(err.message).to.include("Couldn't confirm whether");
      expect(err.message).to.include('Local authentication was kept');
      expect(err.message).not.to.include('No changes were saved');
      expect(requestStub.calledOnce).to.be.true;
      expect(removeStub.notCalled).to.be.true;
    });

    it('reports a warning when local auth cleanup fails after the return', async () => {
      removeStub.rejects(new Error('permission denied'));

      const result = await returnPoolOrg(connection, scratchOrg, deps);

      expect(result.status).to.equal('available');
      expect(result.localAuthRemoved).to.be.false;
      expect(result.warnings).to.have.lengthOf(1);
      expect(result.warnings[0]).to.include('permission denied');
    });
  });
});
