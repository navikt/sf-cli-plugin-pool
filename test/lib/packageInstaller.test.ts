import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { Connection, SfError } from '@salesforce/core';
import {
  extractDependencies,
  readSfdxProjectDependencies,
  resolvePackageVersionId,
} from '../../src/lib/packageInstaller.js';
import { PackageKeys } from '../../src/types/pool-prepare.js';

type FakePackageDir = {
  path: string;
  name: string;
  fullPath: string;
  package?: string;
  versionNumber?: string;
  dependencies?: Array<{ package: string; versionNumber?: string }>;
};

function makeProject(aliases: Record<string, string>, dirs: FakePackageDir[]) {
  return {
    getPackageAliases: () => aliases,
    getUniquePackageDirectories: () => dirs,
  };
}

function makeMockConnection(queryResult?: { totalSize: number; done: boolean; records: unknown[] }): Connection {
  const defaultResult = { totalSize: 0, done: true, records: [] };
  return {
    tooling: {
      query: async () => queryResult ?? defaultResult,
    },
  } as unknown as Connection;
}

describe('packageInstaller', () => {
  const $$ = new TestContext();

  afterEach(() => {
    $$.restore();
  });

  describe('resolvePackageVersionId', () => {
    it('resolves 0Ho Package2Id with LATEST build', async () => {
      const conn = makeMockConnection({
        totalSize: 1,
        done: true,
        records: [{ SubscriberPackageVersionId: '04tRESOLVED001' }],
      });

      const result = await resolvePackageVersionId(conn, '0Ho000000000001AAA', '0.1.48.LATEST');
      expect(result).to.equal('04tRESOLVED001');
    });

    it('resolves 0Ho Package2Id with RELEASED build', async () => {
      const conn = makeMockConnection({
        totalSize: 1,
        done: true,
        records: [{ SubscriberPackageVersionId: '04tRESOLVED002' }],
      });

      const result = await resolvePackageVersionId(conn, '0Ho000000000001AAA', '0.1.48.RELEASED');
      expect(result).to.equal('04tRESOLVED002');
    });

    it('resolves 0Ho Package2Id with numeric build number', async () => {
      const conn = makeMockConnection({
        totalSize: 1,
        done: true,
        records: [{ SubscriberPackageVersionId: '04tRESOLVED003' }],
      });

      const result = await resolvePackageVersionId(conn, '0Ho000000000001AAA', '0.1.48.7');
      expect(result).to.equal('04tRESOLVED003');
    });

    it('resolves package by name', async () => {
      const conn = makeMockConnection({
        totalSize: 1,
        done: true,
        records: [{ SubscriberPackageVersionId: '04tRESOLVED004' }],
      });

      const result = await resolvePackageVersionId(conn, 'platform-data-model', '0.1.48.LATEST');
      expect(result).to.equal('04tRESOLVED004');
    });

    it('resolves without versionNumber using latest released', async () => {
      const conn = makeMockConnection({
        totalSize: 1,
        done: true,
        records: [{ SubscriberPackageVersionId: '04tRESOLVED005' }],
      });

      const result = await resolvePackageVersionId(conn, '0Ho000000000001AAA');
      expect(result).to.equal('04tRESOLVED005');
    });

    it('throws PackageVersionNotFoundError when no version found', async () => {
      const conn = makeMockConnection({ totalSize: 0, done: true, records: [] });

      try {
        await resolvePackageVersionId(conn, '0Ho000000000001AAA', '0.1.48.LATEST');
        expect.fail('Expected PackageVersionNotFoundError');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('PackageVersionNotFoundError');
      }
    });

    it('throws InvalidVersionNumberError for malformed version', async () => {
      const conn = makeMockConnection();

      try {
        await resolvePackageVersionId(conn, '0Ho000000000001AAA', '1.2.3');
        expect.fail('Expected InvalidVersionNumberError');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('InvalidVersionNumberError');
      }
    });
  });

  describe('extractDependencies', () => {
    it('returns empty array when no packaging directories are defined', async () => {
      const project = makeProject({ PkgA: '04t000000000001AAA' }, [
        { path: 'force-app', name: 'force-app', fullPath: '/p/force-app' },
      ]);
      const conn = makeMockConnection();

      const deps = await extractDependencies(project, conn);
      expect(deps).to.deep.equal([]);
    });

    it('returns empty array when packaging directory has no dependencies', async () => {
      const project = makeProject({ PkgA: '04t000000000001AAA' }, [
        {
          path: 'force-app',
          name: 'my-app',
          fullPath: '/p/force-app',
          package: 'my-app',
          versionNumber: '1.0.0.NEXT',
        },
      ]);
      const conn = makeMockConnection();

      const deps = await extractDependencies(project, conn);
      expect(deps).to.deep.equal([]);
    });

    it('resolves 04t package IDs from packageAliases with optional keys', async () => {
      const project = makeProject(
        {
          PkgA: '04t000000000001AAA',
          PkgB: '04t000000000002BBB',
        },
        [
          {
            path: 'force-app',
            name: 'my-app',
            fullPath: '/p/force-app',
            package: 'my-app',
            versionNumber: '1.0.0.NEXT',
            dependencies: [{ package: 'PkgA' }, { package: 'PkgB' }],
          },
        ]
      );
      const conn = makeMockConnection();

      const keys: PackageKeys = { PkgA: 'key1' };
      const deps = await extractDependencies(project, conn, keys);

      expect(deps).to.have.lengthOf(2);
      expect(deps[0].alias).to.equal('PkgA');
      expect(deps[0].packageId).to.equal('04t000000000001AAA');
      expect(deps[0].installationKey).to.equal('key1');
      expect(deps[1].alias).to.equal('PkgB');
      expect(deps[1].installationKey).to.be.undefined;
    });

    it('deduplicates packages appearing in multiple directories', async () => {
      const project = makeProject({ PkgA: '04t000000000001AAA' }, [
        {
          path: 'app1',
          name: 'app1',
          fullPath: '/p/app1',
          package: 'app1',
          versionNumber: '1.0.0.NEXT',
          dependencies: [{ package: 'PkgA' }],
        },
        {
          path: 'app2',
          name: 'app2',
          fullPath: '/p/app2',
          package: 'app2',
          versionNumber: '1.0.0.NEXT',
          dependencies: [{ package: 'PkgA' }],
        },
      ]);
      const conn = makeMockConnection();

      const deps = await extractDependencies(project, conn);
      expect(deps).to.have.lengthOf(1);
    });

    it('resolves 0Ho aliases via DevHub query', async () => {
      const project = makeProject({ PkgA: '0Ho000000000001AAA' }, [
        {
          path: 'force-app',
          name: 'my-app',
          fullPath: '/p/force-app',
          package: 'my-app',
          versionNumber: '1.0.0.NEXT',
          dependencies: [{ package: 'PkgA', versionNumber: '1.0.0.LATEST' }],
        },
      ]);
      const conn = makeMockConnection({
        totalSize: 1,
        done: true,
        records: [{ SubscriberPackageVersionId: '04tRESOLVED001' }],
      });

      const deps = await extractDependencies(project, conn);
      expect(deps).to.have.lengthOf(1);
      expect(deps[0].packageId).to.equal('04tRESOLVED001');
      expect(deps[0].alias).to.equal('PkgA');
    });

    it('resolves package name (no alias) via DevHub query', async () => {
      const project = makeProject({}, [
        {
          path: 'force-app',
          name: 'my-app',
          fullPath: '/p/force-app',
          package: 'my-app',
          versionNumber: '1.0.0.NEXT',
          dependencies: [{ package: 'SomeExternalPkg', versionNumber: '2.0.0.RELEASED' }],
        },
      ]);
      const conn = makeMockConnection({
        totalSize: 1,
        done: true,
        records: [{ SubscriberPackageVersionId: '04tRESOLVED002' }],
      });

      const deps = await extractDependencies(project, conn);
      expect(deps).to.have.lengthOf(1);
      expect(deps[0].packageId).to.equal('04tRESOLVED002');
      expect(deps[0].alias).to.equal('SomeExternalPkg');
    });

    it('handles dep.package as direct 04t ID when no alias exists', async () => {
      const project = makeProject({}, [
        {
          path: 'force-app',
          name: 'my-app',
          fullPath: '/p/force-app',
          package: 'my-app',
          versionNumber: '1.0.0.NEXT',
          dependencies: [{ package: '04tDIRECT000001AAA' }],
        },
      ]);
      const conn = makeMockConnection();

      const deps = await extractDependencies(project, conn);
      expect(deps).to.have.lengthOf(1);
      expect(deps[0].packageId).to.equal('04tDIRECT000001AAA');
    });
  });

  describe('readSfdxProjectDependencies', () => {
    it('throws SfdxProjectNotFoundError when sfdx-project.json does not exist', async () => {
      const conn = makeMockConnection();
      try {
        await readSfdxProjectDependencies('/nonexistent/path/that/does/not/exist/sfdx-project.json', conn);
        expect.fail('Expected SfdxProjectNotFoundError');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('SfdxProjectNotFoundError');
      }
    });
  });
});
