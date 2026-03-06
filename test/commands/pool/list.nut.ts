import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { PoolListResult } from '../../../src/commands/pool/list.js';

describe('pool list NUTs', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'AUTO' });
  });

  after(async () => {
    await session?.clean();
  });

  it('should return valid JSON result with pools array', () => {
    const result = execCmd<PoolListResult>('pool list --json', { ensureExitCode: 0 }).jsonOutput?.result;
    expect(result).to.have.property('pools').that.is.an('array');
    expect(result).to.have.property('totals').that.has.property('totalOrgs').that.is.a('number');
  });

  it('should filter by --pool-tag', () => {
    const result = execCmd<PoolListResult>('pool list --pool-tag nonexistent-tag-12345 --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result).to.have.property('pools').that.is.an('array');
    expect(result!.totals.totalOrgs).to.equal(0);
  });

  it('should support multiple --pool-tag values', () => {
    const result = execCmd<PoolListResult>('pool list --pool-tag tagA --pool-tag tagB --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result).to.have.property('pools').that.is.an('array');
  });

  it('should produce human-readable output without --json', () => {
    const output = execCmd('pool list', { ensureExitCode: 0 }).shellOutput.stdout;
    expect(output).to.include('Scratch Org Pool Totals');
    expect(output).to.include('Total Scratch Orgs in the Pool');
  });
});
