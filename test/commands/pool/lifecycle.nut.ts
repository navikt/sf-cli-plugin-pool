import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execCmd, ExecCmdResult } from '@salesforce/cli-plugins-testkit';
import { Connection, Org, StateAggregator, trimTo15 } from '@salesforce/core';
import { expect } from 'chai';
// Import only types from src/: running any of its modules here would make c8 enforce the coverage thresholds on them.
import { PoolPrepareCommandResult } from '../../../src/commands/pool/prepare.js';
import { PoolListResult } from '../../../src/commands/pool/list.js';
import { PoolFetchResult } from '../../../src/types/pool-fetch.js';
import { PoolCleanResult } from '../../../src/types/pool-clean.js';
import { PoolReturnResult } from '../../../src/types/pool-return.js';

describe('pool lifecycle NUTs', () => {
  const targetDevHubFlag = '--target-dev-hub testdevhub';
  const poolTag = `nut-test-pool-${process.env.GITHUB_RUN_ID ?? randomUUID()}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  const poolConfigFile = join(tmpdir(), `${poolTag}.json`);
  const poolConfig = JSON.parse(readFileSync('config/pool-example.json', 'utf8')) as {
    pools: Array<{ tag: string }>;
  };
  poolConfig.pools.forEach((pool) => {
    pool.tag = poolTag;
  });
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

  // Best effort: orgs left behind by a failed or cancelled run would break the next run's prepare step.
  const cleanTestPool = (): void => {
    const command = `pool clean ${targetDevHubFlag} --pool-tag ${poolTag} --all --no-prompt --json`;
    try {
      logCommandOutput(command, execCmd(command));
    } catch (error) {
      process.stderr.write(`[NUT DEBUG] Couldn't clean ${poolTag}: ${(error as Error).message}\n`);
    }
  };

  before(() => {
    writeFileSync(poolConfigFile, JSON.stringify(poolConfig));
  });
  before(cleanTestPool);
  after(cleanTestPool);
  after(() => rmSync(poolConfigFile, { force: true }));

  const getDevHubConnection = async () => (await Org.create({ aliasOrUsername: 'testdevhub' })).getConnection();

  type AssignedOrg = {
    infoId: string;
    activeId: string;
    allocationStatus: string;
    claimToken: string | null;
  };

  const getAssignedOrg = async (connection: Connection): Promise<AssignedOrg> => {
    const scratchOrg = await Org.create({ aliasOrUsername: 'nutAlias' });
    const row = await connection.singleRecordQuery<{
      Id: string;
      ScratchOrgInfo: { Id: string; Pool_allocation_status__c: string; Pool_claim_token__c: string | null };
    }>(
      `SELECT Id, ScratchOrgInfo.Id, ScratchOrgInfo.Pool_allocation_status__c, ScratchOrgInfo.Pool_claim_token__c FROM ActiveScratchOrg WHERE ScratchOrg = '${trimTo15(scratchOrg.getOrgId())}'`,
    );
    return {
      infoId: row.ScratchOrgInfo.Id,
      activeId: row.Id,
      allocationStatus: row.ScratchOrgInfo.Pool_allocation_status__c,
      claimToken: row.ScratchOrgInfo.Pool_claim_token__c,
    };
  };

  type Subresponse = { httpStatusCode: number; body: Array<{ errorCode?: string }> | null };

  // Sends the updates as one all-or-none Composite request, like `pool return`. The Dev Hub reports
  // failed subrequests in the response body of an HTTP 200, so callers inspect the subresponses.
  const patchInOneTransaction = async (
    connection: Connection,
    updates: Array<{ sobject: string; id: string; body: Record<string, unknown> }>,
  ): Promise<Subresponse[]> => {
    const apiPath = `/services/data/v${connection.getApiVersion()}`;
    const response = await connection.request<{ compositeResponse: Subresponse[] }>({
      method: 'POST',
      url: `${apiPath}/composite`,
      body: JSON.stringify({
        allOrNone: true,
        compositeRequest: updates.map(({ sobject, id, body }, index) => ({
          method: 'PATCH',
          url: `${apiPath}/sobjects/${sobject}/${id}`,
          referenceId: `update${index}`,
          body,
        })),
      }),
      headers: { 'content-type': 'application/json' },
    });
    return response.compositeResponse;
  };

  it('should prepare the pool and return valid JSON', () => {
    const result = execJsonResult<PoolPrepareCommandResult>(
      `pool prepare ${targetDevHubFlag} --config-file "${poolConfigFile}" --json`,
    );

    expect(result).to.have.property('pools').that.is.an('array');
    expect(result?.pools).to.have.lengthOf(1);

    const pool = result?.pools[0];
    expect(pool).to.include({ tag: poolTag, requested: 1, skipped: false });
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
      `pool prepare ${targetDevHubFlag} --config-file "${poolConfigFile}" --json`,
    );

    expect(result?.pools).to.have.lengthOf(1);

    const pool = result?.pools[0];
    expect(pool).to.include({ tag: poolTag, requested: 1, existing: 1, created: 0, failed: 0, skipped: true });
    expect(pool?.errors).to.be.an('array').that.is.empty;
  });

  it('should list the prepared pool with an available org', () => {
    const result = execJsonResult<PoolListResult>(`pool list ${targetDevHubFlag} --pool-tag ${poolTag} --json`);

    expect(result).to.have.property('pools').that.is.an('array');
    expect(result?.totals.totalOrgs).to.equal(1);

    const pool = result?.pools.find((entry) => entry.tag === poolTag);
    expect(pool).to.exist;
    expect(pool?.total).to.equal(1);
    expect(pool?.status).to.have.property('available').that.is.greaterThan(0);
  });

  it('should produce human-readable list output', () => {
    const output = execCmd(`pool list ${targetDevHubFlag} --pool-tag ${poolTag}`, {
      ensureExitCode: 0,
    }).shellOutput.stdout;

    expect(output).to.include('Scratch Org Pool Totals');
    expect(output).to.include('Total Scratch Orgs in the Pool');
  });

  it('should fetch the org with an alias and return valid JSON', () => {
    const result = execJsonResult<PoolFetchResult>(
      `pool fetch ${targetDevHubFlag} --pool-tag ${poolTag} --alias nutAlias --json`,
    );

    expect(result).to.have.property('username').that.is.a('string');
    expect(result).to.have.property('orgId').that.is.a('string');
    expect(result).to.include({ poolTag, alias: 'nutAlias' });
    expect(result?.isDefault).to.be.false;
    fetched = result;
  });

  it('should mark the fetched org as assigned', () => {
    const result = execJsonResult<PoolListResult>(`pool list ${targetDevHubFlag} --pool-tag ${poolTag} --json`);

    const pool = result?.pools.find((entry) => entry.tag === poolTag);
    expect(pool).to.exist;
    expect(pool?.status).to.have.property('assigned').that.is.greaterThan(0);
  });

  // `pool return` re-writes the claim token it observed as the first step of its all-or-none Composite
  // request. These two tests verify, against a real Dev Hub, that this rejects a stale return and that
  // a failure rolls back the other updates.
  it('should accept the current claim token and reject a changed one', async () => {
    const connection = await getDevHubConnection();
    const { infoId, claimToken } = await getAssignedOrg(connection);
    if (!claimToken) {
      expect.fail('Expected the fetched org to have a claim token');
    }

    const [current] = await patchInOneTransaction(connection, [
      { sobject: 'ScratchOrgInfo', id: infoId, body: { Pool_claim_token__c: claimToken } },
    ]);
    expect(current.httpStatusCode).to.be.within(200, 299);

    const [changed] = await patchInOneTransaction(connection, [
      { sobject: 'ScratchOrgInfo', id: infoId, body: { Pool_claim_token__c: 'nut-stale-token' } },
    ]);
    expect(
      changed.body?.[0]?.errorCode,
      'Is the claim-token validation rule from the README deployed to the Dev Hub?',
    ).to.equal('FIELD_CUSTOM_VALIDATION_EXCEPTION');
    expect((await getAssignedOrg(connection)).claimToken).to.equal(claimToken);
  });

  it('should roll back every update when one of them fails', async () => {
    const connection = await getDevHubConnection();
    const { infoId, activeId, claimToken } = await getAssignedOrg(connection);

    const responses = await patchInOneTransaction(connection, [
      { sobject: 'ScratchOrgInfo', id: infoId, body: { Pool_allocation_status__c: 'available' } },
      { sobject: 'ActiveScratchOrg', id: activeId, body: { OwnerId: '005000000000000AAA' } },
    ]);
    expect(responses[1].httpStatusCode).to.be.at.least(400);

    const unchanged = await getAssignedOrg(connection);
    expect(unchanged.allocationStatus).to.equal('assigned');
    expect(unchanged.claimToken).to.equal(claimToken);
  });

  it('should return the fetched org and remove its local auth', async () => {
    const result = execJsonResult<PoolReturnResult>(`pool return --target-org nutAlias ${targetDevHubFlag} --json`);

    expect(result).to.include({
      orgId: fetched?.orgId,
      poolTag,
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
    const result = execJsonResult<PoolListResult>(`pool list ${targetDevHubFlag} --pool-tag ${poolTag} --json`);

    const pool = result?.pools.find((entry) => entry.tag === poolTag);
    expect(pool?.status).to.have.property('available').that.equals(1);
  });

  it('should fetch the returned org again', () => {
    const result = execJsonResult<PoolFetchResult>(
      `pool fetch ${targetDevHubFlag} --pool-tag ${poolTag} --alias nutAlias --json`,
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
      `pool clean ${targetDevHubFlag} --pool-tag ${poolTag} --all --json --no-prompt`,
    );

    expect(result).to.have.property('orgs').that.is.an('array');
    expect(result).to.have.property('summary');
    expect(result?.orgs.every((org) => org.poolTag === poolTag)).to.be.true;
    expect(result?.summary.total).to.equal(1);
    expect((result?.summary.deleted ?? 0) + (result?.summary.failed ?? 0)).to.equal(result?.summary.total);
  });

  it('should produce human-readable clean output', () => {
    const output = execCmd(`pool clean ${targetDevHubFlag} --pool-tag ${poolTag} --all --no-prompt`, {
      ensureExitCode: 0,
    }).shellOutput.stdout;

    expect(output.includes('Pool Clean Results') || output.includes('No scratch orgs')).to.be.true;
  });
});
