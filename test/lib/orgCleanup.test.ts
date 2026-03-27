import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import { deleteOrg } from '../../src/lib/orgCleanup.js';

describe('orgCleanup', () => {
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

  describe('deleteOrg', () => {
    it('calls the DevHub connection to delete an org', async () => {
      const requests: unknown[] = [];
      $$.fakeConnectionRequest = (request) => {
        requests.push(request);
        return Promise.resolve({ id: 'deletedId', success: true, errors: [] });
      };

      const connection = await devHub.getConnection();
      await deleteOrg(connection, 'a015000000Xyz123');

      expect(requests).to.have.length(1);
    });

    it('throws OrgDeleteError when the deletion fails', async () => {
      $$.fakeConnectionRequest = () => Promise.reject(new Error('Delete failed'));

      const connection = await devHub.getConnection();

      try {
        await deleteOrg(connection, 'a015000000Xyz123');
        expect.fail('Expected OrgDeleteError to be thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('OrgDeleteError');
      }
    });
  });
});
