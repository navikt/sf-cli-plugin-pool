import * as path from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import PoolPrepare from '../../../src/commands/pool/prepare.js';

describe('pool prepare', () => {
  const $$ = new TestContext();
  let devHub: MockTestOrgData;
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let configDir: string;

  before(() => {
    process.setMaxListeners(20);
  });

  after(() => {
    process.setMaxListeners(10);
  });

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    configDir = mkdtempSync(path.join(tmpdir(), 'pool-prepare-command-'));
    devHub = new MockTestOrgData();
    devHub.makeDevHub();
    await $$.stubAuths(devHub);
  });

  afterEach(() => {
    $$.restore();
    rmSync(configDir, { recursive: true, force: true });
  });

  const configFixture = path.resolve('config/pool-example.json');

  it('accepts a CLI concurrency override and keeps JSON output free of progress', async () => {
    const configFile = path.join(configDir, 'pool.json');
    writeFileSync(
      configFile,
      JSON.stringify({
        pools: [
          { tag: 'first', count: 0, concurrency: 1 },
          { tag: 'second', count: 0, concurrency: 2 },
        ],
      }),
    );
    $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });
    const result = await PoolPrepare.run([
      '--target-dev-hub',
      devHub.username,
      '--config-file',
      configFile,
      '--concurrency',
      '4',
      '--json',
    ]);
    expect(result.pools.map((pool) => pool.tag)).to.deep.equal(['first', 'second']);
    expect(result.pools.every((pool) => pool.skipped)).to.be.true;
    expect(sfCommandStubs.log.notCalled).to.be.true;
  });

  for (const concurrency of ['0', '-1', '1.5', 'many', String(Number.MAX_SAFE_INTEGER + 1)]) {
    it(`rejects invalid --concurrency ${concurrency} before querying pools`, async () => {
      const request = $$.SANDBOX.spy(async () => ({ totalSize: 0, done: true, records: [] }));
      $$.fakeConnectionRequest = request;
      try {
        await PoolPrepare.run([
          '--target-dev-hub',
          devHub.username,
          '--config-file',
          configFixture,
          '--concurrency',
          concurrency,
        ]);
        expect.fail('Expected invalid concurrency');
      } catch (error) {
        expect((error as Error).message).to.include('--concurrency');
      }
      expect(request.getCalls().some((call) => JSON.stringify(call.args).includes('Pool_tag__c'))).to.be.false;
    });
  }

  it('skips pools already at capacity and returns skipped=true', async () => {
    $$.fakeConnectionRequest = () =>
      Promise.resolve({
        totalSize: 10,
        done: true,

        records: Array.from({ length: 10 }, (_, i) => ({
          Id: `00${i}`,
          Pool_allocation_status__c: 'Available',
          Pool_tag__c: 'nut-test-pool',
        })),
      });

    const result = await PoolPrepare.run(['--target-dev-hub', devHub.username, '--config-file', configFixture]);

    expect(result.pools).to.have.length.greaterThan(0);
    const ciPool = result.pools.find((p) => p.tag === 'nut-test-pool');
    expect(ciPool?.skipped).to.be.true;
    expect(ciPool?.created).to.equal(0);
  });

  it('returns pools array in JSON result', async () => {
    $$.fakeConnectionRequest = () =>
      Promise.resolve({
        totalSize: 5,
        done: true,

        records: Array.from({ length: 5 }, (_, i) => ({
          Id: `00${i}`,
          Pool_allocation_status__c: 'Available',
          Pool_tag__c: 'nut-test-pool',
        })),
      });

    const result = await PoolPrepare.run(['--target-dev-hub', devHub.username, '--config-file', configFixture]);

    expect(result).to.have.property('pools').that.is.an('array');
    expect(result.pools[0]).to.have.property('tag');
    expect(result.pools[0]).to.have.property('requested');
    expect(result.pools[0]).to.have.property('created');
    expect(result.pools[0]).to.have.property('failed');
    expect(result.pools[0]).to.have.property('skipped');
    expect(result.pools[0]).to.have.property('errors').that.is.an('array');
  });
});
