import * as path from 'node:path';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import PoolPrepare from '../../../src/commands/pool/prepare.js';

describe('pool prepare', () => {
  const $$ = new TestContext();
  let devHub: MockTestOrgData;

  before(() => {
    process.setMaxListeners(20);
  });

  after(() => {
    process.setMaxListeners(10);
  });

  beforeEach(async () => {
    stubSfCommandUx($$.SANDBOX);
    devHub = new MockTestOrgData();
    devHub.makeDevHub();
    await $$.stubAuths(devHub);
  });

  afterEach(() => {
    $$.restore();
  });

  const configFixture = path.resolve('config/pool-example.json');

  it('skips pools already at capacity and returns skipped=true', async () => {
    $$.fakeConnectionRequest = () =>
      Promise.resolve({
        totalSize: 10,
        done: true,
        /* eslint-disable camelcase */
        records: Array.from({ length: 10 }, (_, i) => ({
          Id: `00${i}`,
          Pool_allocation_status__c: 'Available',
          Pool_tag__c: 'ci-pool',
        })),
        /* eslint-enable camelcase */
      });

    const result = await PoolPrepare.run(['--target-dev-hub', devHub.username, '--config-file', configFixture]);

    expect(result.pools).to.have.length.greaterThan(0);
    const ciPool = result.pools.find((p) => p.tag === 'ci-pool');
    expect(ciPool?.skipped).to.be.true;
    expect(ciPool?.created).to.equal(0);
  });

  it('returns pools array in JSON result', async () => {
    $$.fakeConnectionRequest = (request: unknown) => {
      const soql = (request as { url?: string })?.url ?? '';
      const tag = soql.includes('dev-pool') ? 'dev-pool' : 'ci-pool';
      const count = tag === 'dev-pool' ? 5 : 10;
      return Promise.resolve({
        totalSize: count,
        done: true,
        /* eslint-disable camelcase */
        records: Array.from({ length: count }, (_, i) => ({
          Id: `00${i}`,
          Pool_allocation_status__c: 'Available',
          Pool_tag__c: tag,
        })),
        /* eslint-enable camelcase */
      });
    };

    const result = await PoolPrepare.run(['--target-dev-hub', devHub.username, '--config-file', configFixture]);

    expect(result).to.have.property('pools').that.is.an('array');
    expect(result.pools[0]).to.have.property('tag');
    expect(result.pools[0]).to.have.property('requested');
    expect(result.pools[0]).to.have.property('created');
    expect(result.pools[0]).to.have.property('failed');
    expect(result.pools[0]).to.have.property('skipped');
  });
});
