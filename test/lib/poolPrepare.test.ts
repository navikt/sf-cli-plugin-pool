import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import { Org, SfError } from '@salesforce/core';
import {
  loadPoolConfig,
  loadPackageKeys,
  loadPackageKeysFromString,
  resolveOrgsToCreate,
  preparePool,
} from '../../src/lib/poolPrepare.js';
import type { PreparePoolDeps } from '../../src/lib/poolPrepare.js';
import { PoolDefinition } from '../../src/types/pool-config.js';

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function writeTempFile(content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pool-test-'));
  const filePath = path.join(tmpDir, 'pool.json');
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

describe('poolPrepare', () => {
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

  describe('loadPoolConfig', () => {
    for (const concurrency of [0, -1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1]) {
      it(`rejects invalid configured concurrency ${JSON.stringify(concurrency)}`, () => {
        const filePath = writeTempFile(JSON.stringify({ pools: [{ tag: 'invalid-pool', concurrency }] }));
        try {
          expect(() => loadPoolConfig(filePath))
            .to.throw(SfError, "Invalid concurrency for pool 'invalid-pool'")
            .with.property('name', 'PoolConcurrencyInvalidError');
        } finally {
          fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
        }
      });
    }

    it('throws when config file does not exist', () => {
      expect(() => loadPoolConfig('/nonexistent/pool.json'))
        .to.throw(SfError)
        .with.property('name', 'PoolConfigNotFoundError');
    });

    it('throws when config file is invalid JSON', () => {
      const filePath = writeTempFile('not json');
      expect(() => loadPoolConfig(filePath))
        .to.throw(SfError)
        .with.property('name', 'PoolConfigParseError');
    });

    it('throws when config has no pools array', () => {
      const filePath = writeTempFile(JSON.stringify({ notPools: [] }));
      expect(() => loadPoolConfig(filePath))
        .to.throw(SfError)
        .with.property('name', 'PoolConfigInvalidError');
    });

    it('throws when pools array is empty', () => {
      const filePath = writeTempFile(JSON.stringify({ pools: [] }));
      expect(() => loadPoolConfig(filePath))
        .to.throw(SfError)
        .with.property('name', 'PoolConfigInvalidError');
    });

    it('returns parsed config for a valid file', () => {
      const fixture = path.resolve('config/pool-example.json');
      const config = loadPoolConfig(fixture);
      expect(config.pools).to.be.an('array').with.length.greaterThan(0);
      expect(config.pools[0]).to.have.property('tag');
      expect(config.pools[0]).to.have.property('count');
    });
  });

  describe('loadPackageKeys', () => {
    it('returns empty object when no file provided', () => {
      const keys = loadPackageKeys();
      expect(keys).to.deep.equal({});
    });

    it('reads keys from a keys file', () => {
      const filePath = writeTempFile(JSON.stringify({ FilePkg: 'filekey' }));
      const keys = loadPackageKeys(filePath);
      expect(keys['FilePkg']).to.equal('filekey');
    });

    it('throws when keys file does not exist', () => {
      expect(() => loadPackageKeys('/nonexistent/keys.json'))
        .to.throw(SfError)
        .with.property('name', 'PackageKeysFileNotFoundError');
    });

    it('throws when keys file is invalid JSON', () => {
      const filePath = writeTempFile('bad json');
      expect(() => loadPackageKeys(filePath))
        .to.throw(SfError)
        .with.property('name', 'PackageKeysParseError');
    });

    it('throws when a key value is not a string', () => {
      const filePath = writeTempFile(JSON.stringify({ MyPkg: 12345 }));
      expect(() => loadPackageKeys(filePath))
        .to.throw(SfError)
        .with.property('name', 'PackageKeysInvalidError');
    });
  });

  describe('loadPackageKeysFromString', () => {
    it('parses a JSON string into package keys', () => {
      const keys = loadPackageKeysFromString('{"MyPkg":"secret123"}');
      expect(keys['MyPkg']).to.equal('secret123');
    });

    it('parses multiple keys from a JSON string', () => {
      const keys = loadPackageKeysFromString('{"PkgA":"keyA","PkgB":"keyB"}');
      expect(keys['PkgA']).to.equal('keyA');
      expect(keys['PkgB']).to.equal('keyB');
    });

    it('throws PackageKeysParseError for invalid JSON', () => {
      expect(() => loadPackageKeysFromString('not json'))
        .to.throw(SfError)
        .with.property('name', 'PackageKeysParseError');
    });

    it('throws PackageKeysInvalidError when a value is not a string', () => {
      expect(() => loadPackageKeysFromString('{"MyPkg":42}'))
        .to.throw(SfError)
        .with.property('name', 'PackageKeysInvalidError');
    });
  });

  describe('resolveOrgsToCreate', () => {
    const poolDef: PoolDefinition = {
      tag: 'dev-pool',
      count: 5,
      definitionFilePath: 'config/project-scratch-def.json',
    };

    it('returns the full count when no orgs exist', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      const connection = await devHub.getConnection();
      const gap = await resolveOrgsToCreate(connection, poolDef);
      expect(gap).to.equal(5);
    });

    it('returns the gap when some orgs already exist', async () => {
      $$.fakeConnectionRequest = () =>
        Promise.resolve({
          totalSize: 3,
          done: true,
          records: [
            { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'dev-pool' },
            { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'dev-pool' },
            { Id: '003', Pool_allocation_status__c: 'In Use', Pool_tag__c: 'dev-pool' },
          ],
        });

      const connection = await devHub.getConnection();
      const gap = await resolveOrgsToCreate(connection, poolDef);
      expect(gap).to.equal(2);
    });

    it('returns 0 when pool is at or above capacity', async () => {
      $$.fakeConnectionRequest = () =>
        Promise.resolve({
          totalSize: 5,
          done: true,
          records: Array.from({ length: 5 }, (_, i) => ({
            Id: `00${i}`,
            Pool_allocation_status__c: 'Available',
            Pool_tag__c: 'dev-pool',
          })),
        });

      const connection = await devHub.getConnection();
      const gap = await resolveOrgsToCreate(connection, poolDef);
      expect(gap).to.equal(0);
    });
  });

  describe('preparePool', () => {
    const poolDef: PoolDefinition = {
      tag: 'test-pool',
      count: 2,
      definitionFilePath: 'config/project-scratch-def.json',
      expirationDays: 7,
    };

    let createScratchOrgStub: ReturnType<typeof $$.SANDBOX.stub>;
    let tagScratchOrgStub: ReturnType<typeof $$.SANDBOX.stub>;
    let deleteOrgStub: ReturnType<typeof $$.SANDBOX.stub>;
    let readDepsStub: ReturnType<typeof $$.SANDBOX.stub>;
    let installPackageStub: ReturnType<typeof $$.SANDBOX.stub>;
    let deps: PreparePoolDeps;

    beforeEach(() => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });
      createScratchOrgStub = $$.SANDBOX.stub();
      tagScratchOrgStub = $$.SANDBOX.stub().resolves();
      deleteOrgStub = $$.SANDBOX.stub().resolves();
      readDepsStub = $$.SANDBOX.stub().resolves([]);
      installPackageStub = $$.SANDBOX.stub().resolves();

      deps = {
        createScratchOrg: createScratchOrgStub as unknown as PreparePoolDeps['createScratchOrg'],
        tagScratchOrg: tagScratchOrgStub as unknown as PreparePoolDeps['tagScratchOrg'],
        deleteOrg: deleteOrgStub as unknown as PreparePoolDeps['deleteOrg'],
        readSfdxProjectDependencies: readDepsStub as unknown as PreparePoolDeps['readSfdxProjectDependencies'],
        installPackage: installPackageStub as unknown as PreparePoolDeps['installPackage'],
        getTargetOrgConnection: $$.SANDBOX.stub().resolves({}) as unknown as PreparePoolDeps['getTargetOrgConnection'],
        getSfdxAuthUrl: $$.SANDBOX.stub().resolves(
          'force://test-auth-url',
        ) as unknown as PreparePoolDeps['getSfdxAuthUrl'],
      };
    });

    for (const { configured, override, expected } of [
      { configured: undefined, override: undefined, expected: 3 },
      { configured: 2, override: undefined, expected: 2 },
      { configured: 2, override: 1, expected: 1 },
      { configured: 1, override: 4, expected: 4 },
    ]) {
      it(`limits active preparations to ${expected} (config=${configured}, override=${override})`, async () => {
        const gates = Array.from({ length: 5 }, () => deferred<void>());
        let nextOrg = 0;
        createScratchOrgStub.callsFake(async () => {
          const id = String(nextOrg++);
          return { orgId: id, username: id };
        });
        (deps.getSfdxAuthUrl as ReturnType<typeof $$.SANDBOX.stub>).callsFake(async (username: unknown) => {
          await gates[Number(username)].promise;
          return 'force://test-auth-url';
        });

        const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
        const preparing = preparePool(
          hubOrg,
          { ...poolDef, count: 5, concurrency: configured },
          {},
          '.',
          false,
          undefined,
          deps,
          undefined,
          override,
        );

        try {
          await flushWork();
          expect(createScratchOrgStub.callCount).to.equal(expected);
          expect(tagScratchOrgStub.getCalls().filter((call) => call.args[3] === 'available')).to.have.length(0);
          gates[0].resolve();
          await flushWork();
          expect(createScratchOrgStub.callCount).to.equal(expected + 1);
        } finally {
          gates.forEach((gate) => gate.resolve());
          await preparing;
        }
        expect(await preparing).to.include({ created: 5, failed: 0 });
        expect(readDepsStub.calledOnce).to.be.true;
      });
    }

    it('caps workers at the missing count and preserves package ordering while reusing free workers', async () => {
      const gates = Array.from({ length: 3 }, () => deferred<void>());
      let nextOrg = 0;
      createScratchOrgStub.callsFake(async () => {
        const id = String(nextOrg++);
        return { orgId: id, username: id };
      });
      (deps.getTargetOrgConnection as ReturnType<typeof $$.SANDBOX.stub>).callsFake(async (username: unknown) => ({
        username,
      }));
      readDepsStub.resolves([
        { packageId: '04tA', alias: 'A' },
        { packageId: '04tB', alias: 'B' },
      ]);
      const installations: string[] = [];
      installPackageStub.callsFake(async (target: unknown, packageId: unknown) => {
        const connection = target as { username: string };
        installations.push(`${connection.username}:${String(packageId)}`);
        if (packageId === '04tA') await gates[Number(connection.username)].promise;
      });
      const progress = $$.SANDBOX.spy();
      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const preparing = preparePool(
        hubOrg,
        { ...poolDef, count: 3, concurrency: 2 },
        {},
        '.',
        false,
        undefined,
        deps,
        progress,
      );
      try {
        await flushWork();
        expect(createScratchOrgStub.callCount).to.equal(2);
        expect(installations).to.deep.equal(['0:04tA', '1:04tA']);
        gates[1].resolve();
        await flushWork();
        expect(createScratchOrgStub.callCount).to.equal(3);
        expect(installations).to.deep.equal(['0:04tA', '1:04tA', '1:04tB', '2:04tA']);
        gates[2].resolve();
        await flushWork();
        expect(createScratchOrgStub.callCount).to.equal(3);
        expect(progress.getCalls().map((call) => String(call.args[0]))).to.include(
          "[test-pool][slot 2] Package 'B' installed.",
        );
      } finally {
        gates.forEach((gate) => gate.resolve());
        await preparing;
      }
      expect(await preparing).to.include({ created: 3, failed: 0 });
      expect(installations.filter((entry) => entry.startsWith('0:'))).to.deep.equal(['0:04tA', '0:04tB']);
    });

    it('does not start extra work when concurrency exceeds the gap', async () => {
      createScratchOrgStub.resolves({ orgId: 'only-org', username: 'only-user' });
      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(
        hubOrg,
        { ...poolDef, count: 1, concurrency: 10 },
        {},
        '.',
        false,
        undefined,
        deps,
      );
      expect(result).to.include({ created: 1, failed: 0 });
      expect(createScratchOrgStub.calledOnce).to.be.true;
    });

    it('reports errors in slot order even when slots fail in reverse order', async () => {
      const gates = [deferred<{ orgId: string; username: string }>(), deferred<{ orgId: string; username: string }>()];
      createScratchOrgStub.onFirstCall().returns(gates[0].promise);
      createScratchOrgStub.onSecondCall().returns(gates[1].promise);
      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const preparing = preparePool(hubOrg, poolDef, {}, '.', false, undefined, deps);
      await flushWork();
      gates[1].reject(new Error('second slot'));
      await flushWork();
      gates[0].reject(new Error('first slot'));
      const result = await preparing;
      expect(result).to.include({ created: 0, failed: 2 });
      expect(result.errors).to.deep.equal(['first slot', 'second slot']);
    });

    for (const keepFailed of [false, true]) {
      it(`isolates concurrent retries and waits for cleanup (keepFailed=${keepFailed})`, async () => {
        const cleanup = deferred<void>();
        let nextOrg = 0;
        createScratchOrgStub.callsFake(async () => {
          const id = String(nextOrg++);
          return { orgId: id, username: id };
        });
        (deps.getTargetOrgConnection as ReturnType<typeof $$.SANDBOX.stub>).callsFake(async (username: unknown) => ({
          username,
        }));
        readDepsStub.resolves([{ packageId: '04tA', alias: 'A' }]);
        installPackageStub.callsFake(async (target: unknown) => {
          const connection = target as { username: string };
          if (['0', '3'].includes(connection.username)) throw new Error(`install ${connection.username}`);
        });
        if (keepFailed) {
          tagScratchOrgStub.withArgs($$.SANDBOX.match.any, '0', poolDef.tag, 'failed').returns(cleanup.promise);
        } else {
          deleteOrgStub.withArgs($$.SANDBOX.match({ Id: '0' })).returns(cleanup.promise);
        }
        let settled = false;
        const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
        const preparing = preparePool(
          hubOrg,
          { ...poolDef, count: 3, concurrency: 2, retryCount: 1 },
          {},
          '.',
          keepFailed,
          undefined,
          deps,
        ).then((result) => {
          settled = true;
          return result;
        });
        try {
          await flushWork();
          expect(createScratchOrgStub.callCount).to.equal(3);
          expect(settled).to.be.false;
          expect(tagScratchOrgStub.calledWith($$.SANDBOX.match.any, '1', poolDef.tag, 'available')).to.be.true;
          expect(tagScratchOrgStub.calledWith($$.SANDBOX.match.any, '2', poolDef.tag, 'available')).to.be.true;
        } finally {
          cleanup.resolve();
          await preparing;
        }
        const result = await preparing;
        expect(result).to.include({ created: 2, failed: 1 });
        expect(result.errors).to.deep.equal(['install 3']);
        expect(createScratchOrgStub.callCount).to.equal(4);
        if (keepFailed) {
          expect(deleteOrgStub.notCalled).to.be.true;
          expect(
            tagScratchOrgStub
              .getCalls()
              .filter((call) => call.args[3] === 'failed')
              .map((call) => call.args[1]),
          ).to.deep.equal(['0', '3']);
        } else {
          expect(deleteOrgStub.getCalls().map((call) => call.args[0])).to.deep.equal([
            { Id: '0', Pool_allocation_status__c: 'failed', Pool_tag__c: poolDef.tag, SignupUsername: '0' },
            { Id: '3', Pool_allocation_status__c: 'failed', Pool_tag__c: poolDef.tag, SignupUsername: '3' },
          ]);
        }
      });
    }

    it('retries a failed slot successfully while other slots progress', async () => {
      createScratchOrgStub.onFirstCall().rejects(new Error('transient'));
      createScratchOrgStub.onSecondCall().resolves({ orgId: 'good', username: 'good' });
      createScratchOrgStub.onThirdCall().resolves({ orgId: 'retry', username: 'retry' });
      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(hubOrg, { ...poolDef, retryCount: 1 }, {}, '.', false, undefined, deps);
      expect(result).to.include({ created: 2, failed: 0 });
      expect(result.errors).to.be.empty;
      expect(createScratchOrgStub.callCount).to.equal(3);
      expect(deleteOrgStub.notCalled).to.be.true;
    });

    for (const concurrency of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      it(`rejects invalid direct-call concurrency ${concurrency} before creating orgs`, async () => {
        const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
        try {
          await preparePool(hubOrg, poolDef, {}, '.', false, undefined, deps, undefined, concurrency);
          expect.fail('Expected invalid concurrency');
        } catch (error) {
          expect(error).to.be.instanceOf(SfError).with.property('name', 'PoolConcurrencyInvalidError');
        }
        expect(createScratchOrgStub.notCalled).to.be.true;
      });
    }

    it('skips when pool is already at capacity', async () => {
      $$.fakeConnectionRequest = () =>
        Promise.resolve({
          totalSize: 2,
          done: true,
          records: [
            { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'test-pool' },
            { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'test-pool' },
          ],
        });

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(hubOrg, poolDef, {}, '.', false, undefined, deps);

      expect(result.skipped).to.be.true;
      expect(result.created).to.equal(0);
      expect(result.failed).to.equal(0);
      expect(result.errors).to.deep.equal([]);
      expect(createScratchOrgStub.called).to.be.false;
    });

    it('creates orgs to fill the gap', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      createScratchOrgStub.resolves({ orgId: 'org-1', username: 'user@scratch.org' });

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(hubOrg, { ...poolDef, count: 1 }, {}, '.', false, undefined, deps);

      expect(result.skipped).to.be.false;
      expect(result.created).to.equal(1);
      expect(result.failed).to.equal(0);
      expect(result.errors).to.deep.equal([]);
      expect(createScratchOrgStub.calledOnce).to.be.true;
      expect(tagScratchOrgStub.calledWith($$.SANDBOX.match.any, 'org-1', 'test-pool', 'in_progress')).to.be.true;
      expect(tagScratchOrgStub.calledWith($$.SANDBOX.match.any, 'org-1', 'test-pool', 'available')).to.be.true;
    });

    it('installs packages on created orgs', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      createScratchOrgStub.resolves({ orgId: 'org-1', username: 'user@scratch.org' });
      readDepsStub.resolves([
        { packageId: '04t001', alias: 'PkgA', installationKey: 'keyA' },
        { packageId: '04t002', alias: 'PkgB', installationKey: undefined },
      ]);

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      await preparePool(hubOrg, { ...poolDef, count: 1 }, { PkgA: 'keyA' }, '.', false, undefined, deps);

      expect(installPackageStub.callCount).to.equal(2);
      expect(installPackageStub.firstCall.args[1]).to.equal('04t001');
      expect(installPackageStub.secondCall.args[1]).to.equal('04t002');
    });

    it('retries on failure and succeeds on subsequent attempt', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      createScratchOrgStub
        .onFirstCall()
        .rejects(new Error('Transient error'))
        .onSecondCall()
        .resolves({ orgId: 'org-2', username: 'user2@scratch.org' });

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(
        hubOrg,
        { ...poolDef, count: 1, retryCount: 1 },
        {},
        '.',
        false,
        undefined,
        deps,
      );

      expect(result.created).to.equal(1);
      expect(result.failed).to.equal(0);
      expect(createScratchOrgStub.calledTwice).to.be.true;
    });

    it('counts failure when all retries are exhausted', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      createScratchOrgStub.rejects(new Error('Persistent failure'));

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(
        hubOrg,
        { ...poolDef, count: 1, retryCount: 2 },
        {},
        '.',
        false,
        undefined,
        deps,
      );

      expect(result.created).to.equal(0);
      expect(result.failed).to.equal(1);
      expect(result.errors).to.have.length(1);
      expect(result.errors[0]).to.include('Persistent failure');
      expect(createScratchOrgStub.callCount).to.equal(3);
    });

    it('deletes failed org when keepFailed is false', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      createScratchOrgStub.resolves({ orgId: 'org-fail', username: 'fail@scratch.org' });
      tagScratchOrgStub.withArgs($$.SANDBOX.match.any, 'org-fail', 'test-pool', 'Provisioning').resolves();
      installPackageStub.rejects(new Error('Install failed'));
      readDepsStub.resolves([{ packageId: '04t001', alias: 'Pkg', installationKey: undefined }]);

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(hubOrg, { ...poolDef, count: 1 }, {}, '.', false, undefined, deps);

      expect(result.failed).to.equal(1);
      expect(deleteOrgStub.calledOnce).to.be.true;
      const deleteArg = deleteOrgStub.firstCall.args[0] as { Id: string; SignupUsername?: string };
      expect(deleteArg.Id).to.equal('org-fail');
      expect(deleteArg.SignupUsername).to.equal('fail@scratch.org');
    });

    it('tags org as Failed when keepFailed is true', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      createScratchOrgStub.resolves({ orgId: 'org-keep', username: 'keep@scratch.org' });
      tagScratchOrgStub.resolves();
      installPackageStub.rejects(new Error('Install failed'));
      readDepsStub.resolves([{ packageId: '04t001', alias: 'Pkg', installationKey: undefined }]);

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const result = await preparePool(hubOrg, { ...poolDef, count: 1 }, {}, '.', true, undefined, deps);

      expect(result.failed).to.equal(1);
      expect(deleteOrgStub.called).to.be.false;
      expect(tagScratchOrgStub.calledWith($$.SANDBOX.match.any, 'org-keep', 'test-pool', 'failed')).to.be.true;
    });

    it('passes apiVersion to getConnection', async () => {
      $$.fakeConnectionRequest = () =>
        Promise.resolve({
          totalSize: 2,
          done: true,
          records: [
            { Id: '001', Pool_allocation_status__c: 'Available', Pool_tag__c: 'test-pool' },
            { Id: '002', Pool_allocation_status__c: 'Available', Pool_tag__c: 'test-pool' },
          ],
        });

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      const getConnectionSpy = $$.SANDBOX.spy(hubOrg, 'getConnection');

      await preparePool(hubOrg, poolDef, {}, '.', false, '58.0', deps);

      expect(getConnectionSpy.calledWith('58.0')).to.be.true;
    });

    it('stores sfdxAuthUrl on ScratchOrgInfo after org creation', async () => {
      $$.fakeConnectionRequest = () => Promise.resolve({ totalSize: 0, done: true, records: [] });

      createScratchOrgStub.resolves({ orgId: 'org-auth', username: 'auth@scratch.org' });
      const getSfdxAuthUrlStub = deps.getSfdxAuthUrl as ReturnType<typeof $$.SANDBOX.stub>;
      getSfdxAuthUrlStub.resolves('force://PlatformCLI::refresh-token@test.salesforce.com');

      const hubOrg = await Org.create({ aliasOrUsername: devHub.username });
      await preparePool(hubOrg, { ...poolDef, count: 1 }, {}, '.', false, undefined, deps);

      expect(getSfdxAuthUrlStub.calledOnce).to.be.true;
      expect(getSfdxAuthUrlStub.calledWith('auth@scratch.org')).to.be.true;
    });
  });
});
