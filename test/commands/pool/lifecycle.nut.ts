import { execCmd, ExecCmdResult } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { PoolPrepareCommandResult } from '../../../src/commands/pool/prepare.js';
import { PoolListResult } from '../../../src/commands/pool/list.js';
import { PoolFetchResult } from '../../../src/types/pool-fetch.js';
import { PoolCleanResult } from '../../../src/types/pool-clean.js';

describe('pool lifecycle NUTs', () => {
  const targetDevHubFlag = '--target-dev-hub testdevhub';

  const logCommandOutput = (command: string, output: ExecCmdResult<unknown>) => {
    process.stderr.write(`[NUT DEBUG] Command: ${command}\n`);
    process.stderr.write(`[NUT DEBUG] stdout:\n${output.shellOutput.stdout}\n`);
    process.stderr.write(`[NUT DEBUG] stderr:\n${output.shellOutput.stderr}\n`);
    process.stderr.write(`[NUT DEBUG] jsonOutput:\n${JSON.stringify(output.jsonOutput, null, 2)}\n`);
  };

  const execJsonResult = <T>(command: string, ensureExitCode = 0): T => {
    const output = execCmd<T>(command, { ensureExitCode });

    if (!output.jsonOutput?.result) {
      logCommandOutput(command, output);
      expect.fail(`Expected JSON result for command: ${command}`);
    }

    return output.jsonOutput.result;
  };

  it('should prepare the pool and return valid JSON', () => {
    const result = execJsonResult<PoolPrepareCommandResult>(
      `pool prepare ${targetDevHubFlag} --config-file config/pool-example.json --json`
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
      `pool prepare ${targetDevHubFlag} --config-file config/pool-example.json --json`
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
      `pool fetch ${targetDevHubFlag} --pool-tag nut-test-pool --alias nutAlias --json`
    );

    expect(result).to.have.property('username').that.is.a('string');
    expect(result).to.have.property('orgId').that.is.a('string');
    expect(result).to.include({ poolTag: 'nut-test-pool', alias: 'nutAlias' });
    expect(result?.isDefault).to.be.false;
  });

  it('should mark the fetched org as assigned', () => {
    const result = execJsonResult<PoolListResult>(`pool list ${targetDevHubFlag} --pool-tag nut-test-pool --json`);

    const pool = result?.pools.find((entry) => entry.tag === 'nut-test-pool');
    expect(pool).to.exist;
    expect(pool?.status).to.have.property('assigned').that.is.greaterThan(0);
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
      `pool clean ${targetDevHubFlag} --pool-tag nut-test-pool --all --json --no-prompt`
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
