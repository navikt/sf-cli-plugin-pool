import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { PoolPrepareCommandResult } from '../../../src/commands/pool/prepare.js';

describe('pool prepare NUTs', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'AUTO' });
  });

  after(async () => {
    await session?.clean();
  });

  it('should return valid JSON result with pools array', () => {
    const result = execCmd<PoolPrepareCommandResult>('pool prepare --config-file config/pool-example.json --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result).to.have.property('pools').that.is.an('array');
  });

  it('should skip pools already at capacity without creating new orgs', () => {
    execCmd('pool prepare --config-file config/pool-example.json --json', { ensureExitCode: 0 });
    const result = execCmd<PoolPrepareCommandResult>('pool prepare --config-file config/pool-example.json --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    const skipped = result?.pools.every((p) => p.skipped || p.created === 0);
    expect(skipped).to.be.true;
  });

  it('should produce human-readable output without --json', () => {
    const output = execCmd('pool prepare --config-file config/pool-example.json', {
      ensureExitCode: 0,
    }).shellOutput.stdout;
    expect(output).to.include('Pool Prepare Results');
    expect(output).to.include('Pool preparation complete');
  });
});
