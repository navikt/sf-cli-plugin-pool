import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { ConfigAggregator, Lifecycle, Org } from '@salesforce/core';
import type { SfDoctor } from '@salesforce/plugin-info';
import { hook } from '../../src/hooks/diagnostics.js';

describe('diagnostics hook', () => {
  const $$ = new TestContext();
  let devHub: MockTestOrgData;
  let fakeDoctor: SfDoctor;
  let addPluginDataStub: ReturnType<typeof $$.SANDBOX.stub>;
  let addSuggestionStub: ReturnType<typeof $$.SANDBOX.stub>;
  let lifecycleEmitStub: ReturnType<typeof $$.SANDBOX.stub>;

  beforeEach(async () => {
    devHub = new MockTestOrgData();
    devHub.makeDevHub();
    await $$.stubAuths(devHub);

    addPluginDataStub = $$.SANDBOX.stub();
    addSuggestionStub = $$.SANDBOX.stub();

    fakeDoctor = {
      addCommandName: $$.SANDBOX.stub(),
      addDiagnosticStatus: $$.SANDBOX.stub(),
      addPluginData: addPluginDataStub,
      addSuggestion: addSuggestionStub,
      closeStderr: $$.SANDBOX.stub(),
      closeStdout: $$.SANDBOX.stub(),
      createStderrWriteStream: $$.SANDBOX.stub(),
      createStdoutWriteStream: $$.SANDBOX.stub(),
      diagnose: $$.SANDBOX.stub(),
      getDiagnosis: $$.SANDBOX.stub(),
      getDoctoredFilePath: $$.SANDBOX.stub(),
      setExitCode: $$.SANDBOX.stub(),
      writeFileSync: $$.SANDBOX.stub(),
      writeStderr: $$.SANDBOX.stub(),
      writeStdout: $$.SANDBOX.stub(),
    } as unknown as SfDoctor;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lifecycleEmitStub = $$.SANDBOX.stub(Lifecycle.prototype, 'emit' as any).resolves();
  });

  afterEach(() => {
    $$.restore();
  });

  // ---------------------------------------------------------------------------
  // Helper: collect all Doctor:diagnostic events emitted
  // ---------------------------------------------------------------------------
  function emittedDiagnostics(): Array<{ testName: string; status: string }> {
    return lifecycleEmitStub
      .getCalls()
      .filter((c) => c.args[0] === 'Doctor:diagnostic')
      .map((c) => c.args[1] as { testName: string; status: string });
  }

  // ---------------------------------------------------------------------------
  // DevHub configured — all fields pass
  // ---------------------------------------------------------------------------
  describe('when a default DevHub is configured and all fields are accessible', () => {
    beforeEach(() => {
      // Stub ConfigAggregator.create to return a value for TARGET_DEV_HUB
      const fakeAggregator = {
        getPropertyValue: (key: string) => (key === 'target-dev-hub' ? devHub.username : undefined),
      };
      $$.SANDBOX.stub(ConfigAggregator, 'create').resolves(fakeAggregator as unknown as ConfigAggregator);

      // Stub Org.create to return a fake org with a query-able connection
      const fakeConnection = {
        query: $$.SANDBOX.stub().resolves({ totalSize: 0, done: true, records: [] }),
      };
      const fakeOrg = {
        getConnection: () => fakeConnection,
        getUsername: () => devHub.username,
      };
      $$.SANDBOX.stub(Org, 'create').resolves(fakeOrg as unknown as Org);
    });

    it('emits "pass" for the DevHub check', async () => {
      await hook({ doctor: fakeDoctor });
      const devHubDiag = emittedDiagnostics().find((d) => d.testName.includes('default DevHub configured'));
      expect(devHubDiag).to.exist;
      expect(devHubDiag?.status).to.equal('pass');
    });

    it('emits "pass" for all four field checks', async () => {
      await hook({ doctor: fakeDoctor });
      const diags = emittedDiagnostics();

      for (const field of ['Pool_tag__c', 'Pool_allocation_status__c', 'Sfdx_Auth_Url__c', 'Pool_claim_token__c']) {
        const d = diags.find((x) => x.testName.includes(field));
        expect(d, `expected diagnostic for ${field}`).to.exist;
        expect(d?.status).to.equal('pass');
      }
    });

    it('calls addPluginData with the DevHub username', async () => {
      await hook({ doctor: fakeDoctor });
      const devHubCall = addPluginDataStub.getCalls().find((c) => {
        const data = c.args[1] as Record<string, unknown>;
        return 'targetDevHub' in data;
      });
      expect(devHubCall).to.exist;
      expect((devHubCall!.args[1] as Record<string, unknown>).targetDevHub).to.equal(devHub.username);
    });

    it('does not add any suggestions', async () => {
      await hook({ doctor: fakeDoctor });
      expect(addSuggestionStub.callCount).to.equal(0);
    });

    it('emits exactly 5 Doctor:diagnostic events', async () => {
      await hook({ doctor: fakeDoctor });
      expect(emittedDiagnostics()).to.have.lengthOf(5);
    });
  });

  // ---------------------------------------------------------------------------
  // No default DevHub configured
  // ---------------------------------------------------------------------------
  describe('when no default DevHub is configured', () => {
    beforeEach(() => {
      const fakeAggregator = {
        getPropertyValue: (key: string) => (key === 'target-dev-hub' ? devHub.username : undefined),
      };
      $$.SANDBOX.stub(ConfigAggregator, 'create').resolves(fakeAggregator as unknown as ConfigAggregator);
    });

    it('emits "warn" for the DevHub check', async () => {
      await hook({ doctor: fakeDoctor });
      const devHubDiag = emittedDiagnostics().find((d) => d.testName.includes('default DevHub configured'));
      expect(devHubDiag?.status).to.equal('warn');
    });

    it('emits "unknown" for all four field checks', async () => {
      await hook({ doctor: fakeDoctor });
      const diags = emittedDiagnostics();

      for (const field of ['Pool_tag__c', 'Pool_allocation_status__c', 'Sfdx_Auth_Url__c', 'Pool_claim_token__c']) {
        const d = diags.find((x) => x.testName.includes(field));
        expect(d, `expected diagnostic for ${field}`).to.exist;
        expect(d?.status).to.equal('unknown');
      }
    });

    it('adds a no-devhub suggestion', async () => {
      await hook({ doctor: fakeDoctor });
      expect(addSuggestionStub.callCount).to.be.greaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // DevHub configured but a field is missing
  // ---------------------------------------------------------------------------
  describe('when a DevHub is configured but a field is inaccessible', () => {
    beforeEach(() => {
      const fakeAggregator = {
        getPropertyValue: (key: string) => (key === 'target-dev-hub' ? devHub.username : undefined),
      };
      $$.SANDBOX.stub(ConfigAggregator, 'create').resolves(fakeAggregator as unknown as ConfigAggregator);

      const fakeConnection = {
        query: $$.SANDBOX.stub()
          .onFirstCall()
          .rejects(new Error('INVALID_FIELD: No such column Pool_tag__c'))
          .resolves({ totalSize: 0, done: true, records: [] }),
      };
      const fakeOrg = {
        getConnection: () => fakeConnection,
        getUsername: () => devHub.username,
      };
      $$.SANDBOX.stub(Org, 'create').resolves(fakeOrg as unknown as Org);
    });

    it('emits "fail" for the missing field', async () => {
      await hook({ doctor: fakeDoctor });
      const d = emittedDiagnostics().find((x) => x.testName.includes('Pool_tag__c'));
      expect(d?.status).to.equal('fail');
    });

    it('emits "pass" for the remaining accessible fields', async () => {
      await hook({ doctor: fakeDoctor });
      const diags = emittedDiagnostics();
      for (const field of ['Pool_allocation_status__c', 'Sfdx_Auth_Url__c', 'Pool_claim_token__c']) {
        const d = diags.find((x) => x.testName.includes(field));
        expect(d?.status).to.equal('pass');
      }
    });

    it('adds a field-missing suggestion', async () => {
      await hook({ doctor: fakeDoctor });
      expect(addSuggestionStub.callCount).to.be.greaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ConfigAggregator throws
  // ---------------------------------------------------------------------------
  describe('when ConfigAggregator.create throws', () => {
    beforeEach(() => {
      $$.SANDBOX.stub(ConfigAggregator, 'create').rejects(new Error('config read error'));
    });

    it('emits "warn" for the DevHub check and degrades field checks to "unknown"', async () => {
      await hook({ doctor: fakeDoctor });
      const diags = emittedDiagnostics();

      const devHubDiag = diags.find((d) => d.testName.includes('default DevHub configured'));
      expect(devHubDiag?.status).to.equal('warn');

      for (const field of ['Pool_tag__c', 'Pool_allocation_status__c', 'Sfdx_Auth_Url__c', 'Pool_claim_token__c']) {
        const d = diags.find((x) => x.testName.includes(field));
        expect(d?.status, `field ${field} should be unknown`).to.equal('unknown');
      }
    });
  });
});
