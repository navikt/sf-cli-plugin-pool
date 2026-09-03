import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Connection, Org, SfError } from '@salesforce/core';
import { deleteActiveScratchOrg, deleteOrg } from '../../src/lib/orgCleanup.js';

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
    it('deletes scratch org via Org.delete()', async () => {
      const deleteStub = $$.SANDBOX.stub().resolves();
      $$.SANDBOX.stub(Org, 'create').resolves({ delete: deleteStub } as unknown as Org);

      await deleteOrg({
        Id: 'a015000000Xyz123',
        Pool_allocation_status__c: 'Available',
        Pool_tag__c: 'poolA',
        SignupUsername: 'scratch@example.com',
      });

      expect(deleteStub.calledOnce).to.be.true;
    });

    it('throws OrgDeleteError when Org.delete() fails', async () => {
      $$.SANDBOX.stub(Org, 'create').resolves({
        delete: $$.SANDBOX.stub().rejects(new Error('Delete failed')),
      } as unknown as Org);

      try {
        await deleteOrg({
          Id: 'a015000000Xyz123',
          Pool_allocation_status__c: 'Available',
          Pool_tag__c: 'poolA',
          SignupUsername: 'scratch@example.com',
        });
        expect.fail('Expected OrgDeleteError to be thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('OrgDeleteError');
      }
    });

    it('throws OrgDeleteError when SignupUsername is missing', async () => {
      try {
        await deleteOrg({
          Id: 'a015000000Xyz123',
          Pool_allocation_status__c: 'Available',
          Pool_tag__c: 'poolA',
        });
        expect.fail('Expected OrgDeleteError to be thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('OrgDeleteError');
        expect((err as SfError).message).to.include('no SignupUsername');
      }
    });

    it('throws OrgDeleteError when SignupUsername is blank', async () => {
      try {
        await deleteOrg({
          Id: 'a015000000Xyz123',
          Pool_allocation_status__c: 'Available',
          Pool_tag__c: 'poolA',
          SignupUsername: '   ',
        });
        expect.fail('Expected OrgDeleteError to be thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('OrgDeleteError');
      }
    });
  });

  describe('deleteActiveScratchOrg', () => {
    it('deletes the ActiveScratchOrg record through the DevHub connection', async () => {
      const deleteStub = $$.SANDBOX.stub().resolves({ id: 'active-001', success: true, errors: [] });
      const connection = { delete: deleteStub } as unknown as Connection;

      await deleteActiveScratchOrg(connection, 'active-001');

      expect(deleteStub.calledOnceWith('ActiveScratchOrg', 'active-001')).to.be.true;
    });

    it('throws OrgDeleteError when ActiveScratchOrg deletion fails', async () => {
      const connection = {
        delete: $$.SANDBOX.stub().rejects(new Error('Insufficient permissions')),
      } as unknown as Connection;

      try {
        await deleteActiveScratchOrg(connection, 'active-001');
        expect.fail('Expected OrgDeleteError to be thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('OrgDeleteError');
        expect((err as SfError).message).to.include('active-001');
        expect((err as SfError).message).to.include('Insufficient permissions');
      }
    });
  });
});
