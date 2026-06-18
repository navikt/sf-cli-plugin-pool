import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Connection } from '@salesforce/core';
import { checkFieldAccess, FIELD_NAMES } from '../../src/lib/poolDoctor.js';

describe('poolDoctor', () => {
  const $$ = new TestContext();

  afterEach(() => {
    $$.restore();
  });

  // ---------------------------------------------------------------------------
  // FIELD_NAMES constant
  // ---------------------------------------------------------------------------
  describe('FIELD_NAMES', () => {
    it('contains all four expected pool fields', () => {
      expect(FIELD_NAMES).to.include('Pool_tag__c');
      expect(FIELD_NAMES).to.include('Pool_allocation_status__c');
      expect(FIELD_NAMES).to.include('Sfdx_Auth_Url__c');
      expect(FIELD_NAMES).to.include('Pool_claim_token__c');
      expect(FIELD_NAMES).to.have.lengthOf(4);
    });
  });

  // ---------------------------------------------------------------------------
  // checkFieldAccess
  // ---------------------------------------------------------------------------
  describe('checkFieldAccess', () => {
    it('returns "pass" when the query resolves with records', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 1, done: true, records: [{ Id: '001' }] }),
      };

      const result = await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_tag__c');

      expect(result).to.equal('pass');
    });

    it('returns "pass" when the query resolves with no records', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      const result = await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_allocation_status__c');

      expect(result).to.equal('pass');
    });

    it('returns "fail" when query rejects with INVALID_FIELD error', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().rejects(new Error('INVALID_FIELD: No such column Pool_tag__c')),
      };

      const result = await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_tag__c');

      expect(result).to.equal('fail');
    });

    it('returns "fail" when query rejects with INVALID_TYPE error', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().rejects(new Error('INVALID_TYPE: Pool_allocation_status__c is not valid')),
      };

      const result = await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_allocation_status__c');

      expect(result).to.equal('fail');
    });

    it('returns "fail" for case-insensitive INVALID_FIELD match', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().rejects(new Error('invalid_field: unknown column')),
      };

      const result = await checkFieldAccess(fakeConnection as unknown as Connection, 'Sfdx_Auth_Url__c');

      expect(result).to.equal('fail');
    });

    it('re-throws unexpected errors (not INVALID_FIELD/INVALID_TYPE)', async () => {
      const unexpectedError = new Error('QUERY_TIMEOUT: request timed out');
      const fakeConnection = {
        query: $$.SANDBOX.stub().rejects(unexpectedError),
      };

      try {
        await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_claim_token__c');
        expect.fail('Expected checkFieldAccess to throw');
      } catch (err) {
        expect(err).to.equal(unexpectedError);
      }
    });

    it('passes the correct SOQL probe query for Pool_tag__c', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_tag__c');

      expect(fakeConnection.query.calledOnce).to.be.true;
      const queryArg = fakeConnection.query.firstCall.args[0] as string;
      expect(queryArg).to.equal('SELECT Id FROM ScratchOrgInfo WHERE Pool_tag__c != null LIMIT 1');
    });

    it('passes the correct SOQL probe query for Pool_allocation_status__c', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_allocation_status__c');

      const queryArg = fakeConnection.query.firstCall.args[0] as string;
      expect(queryArg).to.equal('SELECT Id FROM ScratchOrgInfo WHERE Pool_allocation_status__c != null LIMIT 1');
    });

    it('passes the correct SOQL probe query for Sfdx_Auth_Url__c', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      await checkFieldAccess(fakeConnection as unknown as Connection, 'Sfdx_Auth_Url__c');

      const queryArg = fakeConnection.query.firstCall.args[0] as string;
      expect(queryArg).to.equal('SELECT Id FROM ScratchOrgInfo WHERE Sfdx_Auth_Url__c != null LIMIT 1');
    });

    it('passes the correct SOQL probe query for Pool_claim_token__c', async () => {
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };

      await checkFieldAccess(fakeConnection as unknown as Connection, 'Pool_claim_token__c');

      const queryArg = fakeConnection.query.firstCall.args[0] as string;
      expect(queryArg).to.equal('SELECT Id FROM ScratchOrgInfo WHERE Pool_claim_token__c != null LIMIT 1');
    });
  });
});
