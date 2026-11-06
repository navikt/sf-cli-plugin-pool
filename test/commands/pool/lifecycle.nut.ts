import { execCmd, ExecCmdResult } from '@salesforce/cli-plugins-testkit';
import { Org, StateAggregator } from '@salesforce/core';
import { expect } from 'chai';
import { PoolPrepareCommandResult } from '../../../src/commands/pool/prepare.js';
import { PoolListResult } from '../../../src/commands/pool/list.js';
import { PoolFetchResult } from '../../../src/types/pool-fetch.js';
import { PoolCleanResult } from '../../../src/types/pool-clean.js';
import { PoolReturnResult } from '../../../src/types/pool-return.js';
import { queryReturnOrg, submitReturnTransaction, toHttpDate } from '../../../src/lib/poolReturn.js';

describe('pool lifecycle NUTs', () => {
  const targetDevHubFlag = '--target-dev-hub testdevhub';
  let fetched: PoolFetchResult | undefined;
  let returned: PoolReturnResult | undefined;

  const logCommandOutput = (command: string, output: ExecCmdResult<unknown>) => {
    process.stderr.write(`[NUT DEBUG] Command: ${command}\n`);
    process.stderr.write(`[NUT DEBUG] stdout:\n${output.shellOutput.stdout}\n`);
    process.stderr.write(`[NUT DEBUG] stderr:\n${output.shellOutput.stderr}\n`);
    process.stderr.write(`[NUT DEBUG] jsonOutput:\n${JSON.stringify(output.jsonOutput, null, 2)}\n`);
  };

  const execJsonResult = <T>(command: string, ensureExitCode = 0): T => {
    const output = execCmd<T>(command, { ensureExitCode });

    logCommandOutput(command, output);

    if (!output.jsonOutput?.result) {
      expect.fail(`Expected JSON result for command: ${command}`);
    }

    return output.jsonOutput.result;
  };

  const getDevHubConnection = async () => (await Org.create({ aliasOrUsername: 'testdevhub' })).getConnection();

  const expectErrorName = async (promise: Promise<unknown>, name: string): Promise<void> => {
    try {
      await promise;
    } catch (error) {
      expect((error as Error).name).to.equal(name);
      return;
    }
    expect.fail(`Expected ${name}`);
  };

  it('should prepare the pool and return valid JSON', () => {
    const result = execJsonResult<PoolPrepareCommandResult>(
      `pool prepare ${targetDevHubFlag} --config-file config/pool-example.json --json`,
    );

    expect(result).to.have.property('pools').that.is.an('array');
    expect(result?.pools).to.have.lengthOf(1);

    const pool = result?.pools[0];
    expect(pool).to.include({ tag: 'nut-test-pool', requested: 1, skipped: false });
    expect(pool?.created).to.equal(1);
    expect(pool?.failed).to.equal(0);
    expect(pool?.errors).to.be.an('array').that.is.empty;
  });

  it('should produce human-readable prepare output', () => {
    const output = execCmd(`pool prepare ${targetDevHubFlag} --config-file config/pool-example.json`, {
      ensureExitCode: 0,
    }).shellOutput.stdout;

    expect(output).to.include('Pool Prepare Results');
    expect(output).to.include('Pool preparation complete');
  });

  it('should skip prepare when the pool is already at capacity', () => {
    const result = execJsonResult<PoolPrepareCommandResult>(
      `pool prepare ${targetDevHubFlag} --config-file config/pool-example.json --json`,
    );

    expect(result?.pools).to.have.lengthOf(1);

    const pool = result?.pools[0];
    expect(pool).to.include({ tag: 'nut-test-pool', requested: 1, existing: 1, created: 0, failed: 0, skipped: true });
    expect(pool?.errors).to.be.an('array').that.is.empty;
  });

  it('should list the prepared pool with an available org', () => {
    const result = execJsonResult<PoolListResult>(`pool list ${targetDevHubFlag} --pool-tag nut-test-pool --json`);

    expect(result).to.have.property('pools').that.is.an('array');
    expect(result?.totals.totalOrgs).to.equal(1);

    const pool = result?.pools.find((entry) => entry.tag === 'nut-test-pool');
    expect(pool).to.exist;
    expect(pool?.total).to.equal(1);
    expect(pool?.status).to.have.property('available').that.is.greaterThan(0);
  });

  it('should produce human-readable list output', () => {
    const output = execCmd(`pool list ${targetDevHubFlag} --pool-tag nut-test-pool`, {
      ensureExitCode: 0,
    }).shellOutput.stdout;

    expect(output).to.include('Scratch Org Pool Totals');
    expect(output).to.include('Total Scratch Orgs in the Pool');
  });

  it('should fetch the org with an alias and return valid JSON', () => {
    const result = execJsonResult<PoolFetchResult>(
      `pool fetch ${targetDevHubFlag} --pool-tag nut-test-pool --alias nutAlias --json`,
    );

    expect(result).to.have.property('username').that.is.a('string');
    expect(result).to.have.property('orgId').that.is.a('string');
    expect(result).to.include({ poolTag: 'nut-test-pool', alias: 'nutAlias' });
    expect(result?.isDefault).to.be.false;
    fetched = result;
  });

  it('should mark the fetched org as assigned', () => {
    const result = execJsonResult<PoolListResult>(`pool list ${targetDevHubFlag} --pool-tag nut-test-pool --json`);

    const pool = result?.pools.find((entry) => entry.tag === 'nut-test-pool');
    expect(pool).to.exist;
    expect(pool?.status).to.have.property('assigned').that.is.greaterThan(0);
  });

  // Verifies the Dev Hub guarantees `pool return` relies on: a stale If-Unmodified-Since precondition
  // rejects the transaction, and a failed subrequest rolls back the whole all-or-none request.
  it('should reject a stale return and roll back a failed return', async () => {
    const connection = await getDevHubConnection();
    const scratchOrg = await Org.create({ aliasOrUsername: 'nutAlias' });
    const [row] = await queryReturnOrg(connection, scratchOrg.getOrgId());
    const info = row?.ScratchOrgInfo;
    const ifUnmodifiedSince = toHttpDate(info?.LastModifiedDate);
    if (!row?.CreatedById || !info?.CreatedById || !ifUnmodifiedSince) {
      expect.fail('Expected the fetched org with creators and a last-modified date in the DevHub');
    }

    const update = {
      username: scratchOrg.getUsername() ?? '',
      scratchOrgInfoId: info.Id,
      scratchOrgInfoOwnerId: info.CreatedById,
      activeScratchOrgId: row.Id,
      activeScratchOrgOwnerId: row.CreatedById,
      sfdxAuthUrl: scratchOrg.getConnection().getAuthInfo().getSfdxAuthUrl(),
      ifUnmodifiedSince,
    };
    const stale = new Date(Date.parse(ifUnmodifiedSince) - 60_000).toUTCString();

    await expectErrorName(
      submitReturnTransaction(connection, { ...update, ifUnmodifiedSince: stale }),
      'PoolReturnStaleError',
    );
    await expectErrorName(
      submitReturnTransaction(connection, { ...update, activeScratchOrgOwnerId: '005000000000000AAA' }),
      'PoolReturnUpdateError',
    );

    const unchanged = await connection.singleRecordQuery<{
      OwnerId: string;
      Pool_allocation_status__c: string;
      Sfdx_Auth_Url__c: string | null;
    }>(`SELECT OwnerId, Pool_allocation_status__c, Sfdx_Auth_Url__c FROM ScratchOrgInfo WHERE Id = '${info.Id}'`);
    expect(unchanged.Pool_allocation_status__c).to.equal('assigned');
    expect(unchanged.OwnerId).to.equal(info.OwnerId);
    expect(Boolean(unchanged.Sfdx_Auth_Url__c)).to.be.false;
  });

  it('should return the fetched org and remove its local auth', async () => {
    const result = execJsonResult<PoolReturnResult>(`pool return --target-org nutAlias ${targetDevHubFlag} --json`);

    expect(result).to.include({
      orgId: fetched?.orgId,
      poolTag: 'nut-test-pool',
      status: 'available',
      localAuthRemoved: true,
    });
    expect(result.username.toLowerCase()).to.equal(fetched?.username.toLowerCase());
    expect(result.warnings).to.be.empty;
    returned = result;

    StateAggregator.clearInstance();
    const state = await StateAggregator.getInstance();
    expect(state.aliases.getUsername('nutAlias')).not.to.exist;
    expect(await state.orgs.exists(result.username)).to.be.false;
  });

  it('should restore ownership and credentials in the DevHub', async () => {
    const connection = await getDevHubConnection();
    const info = await connection.singleRecordQuery<{
      OwnerId: string;
      CreatedById: string;
      Pool_allocation_status__c: string;
      Pool_claim_token__c: string | null;
      Sfdx_Auth_Url__c: string | null;
    }>(
      `SELECT OwnerId, CreatedById, Pool_allocation_status__c, Pool_claim_token__c, Sfdx_Auth_Url__c FROM ScratchOrgInfo WHERE Id = '${returned?.orgId}'`,
    );
    expect(info.OwnerId).to.equal(info.CreatedById);
    expect(info.Pool_allocation_status__c).to.equal('available');
    expect(info.Pool_claim_token__c).not.to.exist;
    // Assert without printing the credential on failure.
    expect(info.Sfdx_Auth_Url__c?.startsWith('force://') ?? false).to.be.true;

    const activeOrg = await connection.singleRecordQuery<{ OwnerId: string; CreatedById: string }>(
      `SELECT OwnerId, CreatedById FROM ActiveScratchOrg WHERE Id = '${returned?.activeScratchOrgId}'`,
    );
    expect(activeOrg.OwnerId).to.equal(activeOrg.CreatedById);
  });

  it('should list the returned org as available', () => {
    const result = execJsonResult<PoolListResult>(`pool list ${targetDevHubFlag} --pool-tag nut-test-pool --json`);

    const pool = result?.pools.find((entry) => entry.tag === 'nut-test-pool');
    expect(pool?.status).to.have.property('available').that.equals(1);
  });

  it('should fetch the returned org again', () => {
    const result = execJsonResult<PoolFetchResult>(
      `pool fetch ${targetDevHubFlag} --pool-tag nut-test-pool --alias nutAlias --json`,
    );

    expect(result.orgId).to.equal(returned?.orgId);
  });

  it('should fail when fetching from a nonexistent pool', () => {
    const output = execCmd(`pool fetch ${targetDevHubFlag} --pool-tag nonexistent-pool-xyz --json`, {
      ensureExitCode: 1,
    });

    if (!output.jsonOutput) {
      logCommandOutput(`pool fetch ${targetDevHubFlag} --pool-tag nonexistent-pool-xyz --json`, output);
      expect.fail('Expected JSON error output for nonexistent pool fetch');
    }

    expect(output.jsonOutput?.name).to.include('Error');
  });

  it('should clean the pool and return valid JSON', () => {
    const result = execJsonResult<PoolCleanResult>(
      `pool clean ${targetDevHubFlag} --pool-tag nut-test-pool --all --json --no-prompt`,
    );

    expect(result).to.have.property('orgs').that.is.an('array');
    expect(result).to.have.property('summary');
    expect(result?.orgs.every((org) => org.poolTag === 'nut-test-pool')).to.be.true;
    expect(result?.summary.total).to.equal(1);
    expect((result?.summary.deleted ?? 0) + (result?.summary.failed ?? 0)).to.equal(result?.summary.total);
  });

  it('should produce human-readable clean output', () => {
    const output = execCmd(`pool clean ${targetDevHubFlag} --pool-tag nut-test-pool --all --no-prompt`, {
      ensureExitCode: 0,
    }).shellOutput.stdout;

    expect(output.includes('Pool Clean Results') || output.includes('No scratch orgs')).to.be.true;
  });
});
