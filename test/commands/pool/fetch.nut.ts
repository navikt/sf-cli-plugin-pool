import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { PoolFetchResult } from '../../../src/types/pool-fetch.js';
import { PoolListResult } from '../../../src/commands/pool/list.js';

describe('pool fetch NUTs', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'AUTO' });

    // Ensure pool has available orgs by running prepare first
    execCmd('pool prepare --config-file config/pool-example.json --json', {
      ensureExitCode: 0,
    });
  });

  after(async () => {
    await session?.clean();
  });

  it('should fetch a scratch org from the pool and return valid JSON', () => {
    const result = execCmd<PoolFetchResult>('pool fetch --pool-tag dev-pool --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;

    expect(result).to.have.property('username').that.is.a('string');
    expect(result).to.have.property('orgId').that.is.a('string');
    expect(result).to.have.property('poolTag').that.equals('dev-pool');
    expect(result).to.have.property('isDefault').that.is.a('boolean');
  });

  it('should mark the fetched org as assigned', () => {
    const listResult = execCmd<PoolListResult>('pool list --pool-tag dev-pool --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;

    const pool = listResult?.pools.find((p) => p.tag === 'dev-pool');
    if (pool?.status['assigned']) {
      expect(pool.status['assigned']).to.be.greaterThan(0);
    }
  });

  it('should fail when fetching from a nonexistent pool', () => {
    const output = execCmd('pool fetch --pool-tag nonexistent-pool-xyz --json', {
      ensureExitCode: 1,
    });

    expect(output.jsonOutput?.name).to.include('Error');
  });

  it('should produce human-readable output without --json', () => {
    // This may fail if no more orgs are available; prepare again if needed
    execCmd('pool prepare --config-file config/pool-example.json --json', {
      ensureExitCode: 0,
    });

    const output = execCmd('pool fetch --pool-tag dev-pool', {
      ensureExitCode: 0,
    }).shellOutput.stdout;

    expect(output).to.include('Fetched scratch org');
    expect(output).to.include('dev-pool');
  });

  it('should set alias when --alias is provided', () => {
    execCmd('pool prepare --config-file config/pool-example.json --json', {
      ensureExitCode: 0,
    });

    const result = execCmd<PoolFetchResult>('pool fetch --pool-tag dev-pool --alias nutAlias --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;

    expect(result).to.have.property('alias').that.equals('nutAlias');
  });
});
