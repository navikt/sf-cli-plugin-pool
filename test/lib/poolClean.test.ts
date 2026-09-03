/* eslint-disable camelcase */
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Connection } from '@salesforce/core';
import { cleanPoolOrgs, CleanPoolDeps } from '../../src/lib/poolClean.js';
import { CleanableOrgRow } from '../../src/types/scratch-org-info.js';

describe('poolClean', () => {
  const $$ = new TestContext();

  afterEach(() => {
    $$.restore();
  });

  const connection = {} as Connection;

  const makeOrg = (id: string, poolTag: string | null, status: string): CleanableOrgRow => ({
    Id: `active-${id}`,
    ScratchOrgInfo: {
      Id: id,
      Pool_tag__c: poolTag,
      Pool_allocation_status__c: status,
    },
  });

  const successDeps: CleanPoolDeps = {
    deleteOrg: async () => {},
  };

  describe('cleanPoolOrgs', () => {
    it('deletes all orgs successfully', async () => {
      const orgs = [
        makeOrg('org-1', 'myPool', 'Available'),
        makeOrg('org-2', 'myPool', 'Available'),
        makeOrg('org-3', 'myPool', 'Allocated'),
      ];

      const result = await cleanPoolOrgs(connection, orgs, successDeps);

      expect(result.summary).to.deep.equal({ deleted: 3, failed: 0, total: 3 });
      for (const org of result.orgs) {
        expect(org.deletionResult).to.equal('deleted');
        expect(org.error).to.be.undefined;
      }
    });

    it('handles partial failures', async () => {
      const orgs = [
        makeOrg('org-1', 'pool', 'Available'),
        makeOrg('org-2', 'pool', 'Available'),
        makeOrg('org-3', 'pool', 'Available'),
      ];

      const deps: CleanPoolDeps = {
        deleteOrg: async (_connection, activeScratchOrgId) => {
          if (activeScratchOrgId === 'active-org-2') {
            throw new Error('Permission denied');
          }
        },
      };

      const result = await cleanPoolOrgs(connection, orgs, deps);

      expect(result.summary).to.deep.equal({ deleted: 2, failed: 1, total: 3 });
      expect(result.orgs[0].deletionResult).to.equal('deleted');
      expect(result.orgs[1].deletionResult).to.equal('failed');
      expect(result.orgs[1].error).to.equal('Permission denied');
      expect(result.orgs[2].deletionResult).to.equal('deleted');
    });

    it('handles all failures', async () => {
      const orgs = [makeOrg('org-1', 'pool', 'Available'), makeOrg('org-2', 'pool', 'Available')];

      const deps: CleanPoolDeps = {
        deleteOrg: async () => {
          throw new Error('Server error');
        },
      };

      const result = await cleanPoolOrgs(connection, orgs, deps);

      expect(result.summary).to.deep.equal({ deleted: 0, failed: 2, total: 2 });
      for (const org of result.orgs) {
        expect(org.deletionResult).to.equal('failed');
        expect(org.error).to.equal('Server error');
      }
    });

    it('returns empty result for empty input', async () => {
      const result = await cleanPoolOrgs(connection, [], successDeps);

      expect(result.summary).to.deep.equal({ deleted: 0, failed: 0, total: 0 });
      expect(result.orgs).to.have.length(0);
    });

    it('calls onProgress callback with expected messages', async () => {
      const orgs = [makeOrg('org-1', 'myPool', 'Available')];
      const messages: string[] = [];

      await cleanPoolOrgs(connection, orgs, successDeps, (msg) => messages.push(msg));

      expect(messages).to.have.length(2);
      expect(messages[0]).to.equal('Deleting scratch org org-1 (pool: myPool, status: Available)...');
      expect(messages[1]).to.equal('Deleted scratch org org-1.');
    });

    it('calls onProgress with failure message when deletion fails', async () => {
      const orgs = [makeOrg('org-1', 'pool', 'Available')];
      const messages: string[] = [];
      const deps: CleanPoolDeps = {
        deleteOrg: async () => {
          throw new Error('boom');
        },
      };

      await cleanPoolOrgs(connection, orgs, deps, (msg) => messages.push(msg));

      expect(messages).to.have.length(2);
      expect(messages[0]).to.include('Deleting scratch org org-1');
      expect(messages[1]).to.equal('Failed to delete scratch org org-1: boom');
    });

    it('handles null Pool_tag__c by using "undefined"', async () => {
      const orgs = [makeOrg('org-1', null, 'Available')];

      const result = await cleanPoolOrgs(connection, orgs, successDeps);

      expect(result.orgs[0].poolTag).to.equal('undefined');
    });

    it('preserves org info in results', async () => {
      const orgs = [makeOrg('org-xyz', 'teamPool', 'Allocated')];

      const result = await cleanPoolOrgs(connection, orgs, successDeps);

      const orgResult = result.orgs[0];
      expect(orgResult.scratchOrgId).to.equal('org-xyz');
      expect(orgResult.poolTag).to.equal('teamPool');
      expect(orgResult.status).to.equal('Allocated');
    });

    it('handles non-Error thrown values', async () => {
      const orgs = [makeOrg('org-1', 'pool', 'Available')];
      const deps: CleanPoolDeps = {
        deleteOrg: async () => {
          throw 'string error';
        },
      };

      const result = await cleanPoolOrgs(connection, orgs, deps);

      expect(result.orgs[0].deletionResult).to.equal('failed');
      expect(result.orgs[0].error).to.equal('string error');
    });

    it('passes the DevHub connection and ActiveScratchOrg Id to the deleter', async () => {
      const deleteStub = $$.SANDBOX.stub().resolves();
      const deps: CleanPoolDeps = { deleteOrg: deleteStub };

      await cleanPoolOrgs(connection, [makeOrg('scratch-1', 'pool', 'available')], deps);

      expect(deleteStub.calledOnceWith(connection, 'active-scratch-1')).to.be.true;
    });
  });
});
