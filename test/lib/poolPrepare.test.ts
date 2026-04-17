import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
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
    devHub = new MockTestOrgData();
    devHub.makeDevHub();
    await $$.stubAuths(devHub);
  });

  afterEach(() => {
    $$.restore();
  });

  describe('loadPoolConfig', () => {
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
      };
    });

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
        deps
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
        deps
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
      expect(deleteOrgStub.calledWith($$.SANDBOX.match.any, 'org-fail')).to.be.true;
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
  });
});
