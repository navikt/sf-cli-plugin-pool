import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import {
  loadPoolConfig,
  loadPackageKeys,
  loadPackageKeysFromString,
  resolveOrgsToCreate,
} from '../../src/lib/poolPrepare.js';
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
});
