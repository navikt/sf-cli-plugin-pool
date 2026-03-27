import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Org, SfError } from '@salesforce/core';
import { createScratchOrg, tagScratchOrg } from '../../src/lib/orgCreator.js';

/* eslint-disable camelcase */
describe('orgCreator', () => {
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

  describe('createScratchOrg', () => {
    it('throws ScratchOrgCreateError when scratchOrgCreate fails', async () => {
      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const failingFn = async () => {
        throw new Error('DevHub limit reached');
      };

      try {
        await createScratchOrg(hubOrg, 'config/project-scratch-def.json', 7, failingFn);
        expect.fail('Expected ScratchOrgCreateError');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('ScratchOrgCreateError');
      }
    });

    it('throws ScratchOrgCreateError when result has no username or orgId', async () => {
      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const emptyResultFn = async () => ({ warnings: [], scratchOrgInfo: {} as never });

      try {
        await createScratchOrg(hubOrg, 'config/project-scratch-def.json', 7, emptyResultFn);
        expect.fail('Expected ScratchOrgCreateError');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('ScratchOrgCreateError');
      }
    });

    it('returns orgId and username from scratchOrgInfo', async () => {
      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const successFn = async () => ({
        warnings: [],
        username: 'test@scratch.org',
        scratchOrgInfo: {
          Id: 'a00500000000001AAA',
          Username: 'test@scratch.org',
          LoginUrl: 'https://login.salesforce.com',
          AuthCode: 'code',
          Status: 'Active' as const,
          SignupEmail: 'test@example.com',
          SignupUsername: 'test@scratch.org',
          SignupInstance: 'CS1',
        },
      });

      $$.fakeConnectionRequest = () => Promise.resolve({ id: 'mockId', success: true, errors: [] });

      const result = await createScratchOrg(hubOrg, 'config/project-scratch-def.json', 7, successFn);
      expect(result.orgId).to.equal('a00500000000001AAA');
      expect(result.username).to.equal('test@scratch.org');
    });
  });

  describe('tagScratchOrg', () => {
    it('updates ScratchOrgInfo with tag and status', async () => {
      const requests: unknown[] = [];
      $$.fakeConnectionRequest = (request) => {
        requests.push(request);
        return Promise.resolve({ id: 'mockId', success: true, errors: [] });
      };

      const connection = await devHub.getConnection();

      await tagScratchOrg(connection, 'a005000000Abc123', 'my-pool', 'Available');

      expect(requests).to.have.length(1);
    });

    it('throws ScratchOrgTagError when update fails', async () => {
      $$.fakeConnectionRequest = () => Promise.reject(new Error('SOQL failed'));

      const connection = await devHub.getConnection();

      try {
        await tagScratchOrg(connection, 'a005000000Abc123', 'my-pool', 'Available');
        expect.fail('Expected ScratchOrgTagError to be thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('ScratchOrgTagError');
      }
    });
  });
});
