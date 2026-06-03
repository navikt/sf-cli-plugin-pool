import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { PoolCleanResult } from '../../../src/types/pool-clean.js';

describe('pool clean NUTs', () => {
  let session: TestSession;

  before(async () => {
    session = await TestSession.create({ devhubAuthStrategy: 'AUTO' });
  });

  after(async () => {
    await session?.clean();
  });

  it('should return valid JSON result with orgs array and summary', () => {
    const result = execCmd<PoolCleanResult>('pool clean --json --no-prompt', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result).to.have.property('orgs').that.is.an('array');
    expect(result).to.have.property('summary');
    expect(result?.summary).to.have.property('deleted').that.is.a('number');
    expect(result?.summary).to.have.property('failed').that.is.a('number');
    expect(result?.summary).to.have.property('total').that.is.a('number');
  });

  it('should clean a specific pool by tag', () => {
    const result = execCmd<PoolCleanResult>('pool clean --pool-tag nut-test-pool --json --no-prompt', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result).to.have.property('orgs').that.is.an('array');
    expect(result).to.have.property('summary');
    expect(result?.summary).to.have.property('deleted').that.is.a('number');
    expect(result?.summary).to.have.property('failed').that.is.a('number');
    expect(result?.summary).to.have.property('total').that.is.a('number');
  });

  it('should clean all statuses when --all is passed', () => {
    const result = execCmd<PoolCleanResult>('pool clean --all --json --no-prompt', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result).to.have.property('orgs').that.is.an('array');
    expect(result).to.have.property('summary');
    expect(result?.summary).to.have.property('deleted').that.is.a('number');
    expect(result?.summary).to.have.property('failed').that.is.a('number');
    expect(result?.summary).to.have.property('total').that.is.a('number');
  });

  it('should produce human-readable output without --json', () => {
    const output = execCmd('pool clean --no-prompt', {
      ensureExitCode: 0,
    }).shellOutput.stdout;
    // Output contains either the summary header or a "no orgs" message
    const hasExpectedOutput = output.includes('Pool Clean Results') || output.includes('No scratch orgs');
    expect(hasExpectedOutput).to.be.true;
  });
});
