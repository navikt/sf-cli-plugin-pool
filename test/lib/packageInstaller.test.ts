import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { SfError } from '@salesforce/core';
import { extractDependencies, readSfdxProjectDependencies } from '../../src/lib/packageInstaller.js';
import { PackageKeys } from '../../src/types/pool-prepare.js';

type FakePackageDir = {
  path: string;
  name: string;
  fullPath: string;
  package?: string;
  versionNumber?: string;
  dependencies?: Array<{ package: string }>;
};

function makeProject(aliases: Record<string, string>, dirs: FakePackageDir[]) {
  return {
    getPackageAliases: () => aliases,
    getUniquePackageDirectories: () => dirs,
  };
}

describe('packageInstaller', () => {
  const $$ = new TestContext();

  afterEach(() => {
    $$.restore();
  });

  describe('extractDependencies', () => {
    it('returns empty array when no packaging directories are defined', () => {
      const project = makeProject({ PkgA: '04t000000000001AAA' }, [
        { path: 'force-app', name: 'force-app', fullPath: '/p/force-app' },
      ]);

      const deps = extractDependencies(project);
      expect(deps).to.deep.equal([]);
    });

    it('returns empty array when packaging directory has no dependencies', () => {
      const project = makeProject({ PkgA: '04t000000000001AAA' }, [
        {
          path: 'force-app',
          name: 'my-app',
          fullPath: '/p/force-app',
          package: 'my-app',
          versionNumber: '1.0.0.NEXT',
        },
      ]);

      const deps = extractDependencies(project);
      expect(deps).to.deep.equal([]);
    });

    it('resolves 04t package IDs from packageAliases with optional keys', () => {
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

      const keys: PackageKeys = { PkgA: 'key1' };
      const deps = extractDependencies(project, keys);

      expect(deps).to.have.lengthOf(2);
      expect(deps[0].alias).to.equal('PkgA');
      expect(deps[0].packageId).to.equal('04t000000000001AAA');
      expect(deps[0].installationKey).to.equal('key1');
      expect(deps[1].alias).to.equal('PkgB');
      expect(deps[1].installationKey).to.be.undefined;
    });

    it('deduplicates packages appearing in multiple directories', () => {
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

      const deps = extractDependencies(project);
      expect(deps).to.have.lengthOf(1);
    });

    it('skips aliases that do not start with 04t', () => {
      const project = makeProject({ PkgA: '0Ho000000000001AAA' }, [
        {
          path: 'force-app',
          name: 'my-app',
          fullPath: '/p/force-app',
          package: 'my-app',
          versionNumber: '1.0.0.NEXT',
          dependencies: [{ package: 'PkgA' }],
        },
      ]);

      const deps = extractDependencies(project);
      expect(deps).to.deep.equal([]);
    });

    it('throws PackageAliasNotFoundError when a dep alias is missing', () => {
      const project = makeProject({}, [
        {
          path: 'force-app',
          name: 'my-app',
          fullPath: '/p/force-app',
          package: 'my-app',
          versionNumber: '1.0.0.NEXT',
          dependencies: [{ package: 'MissingAlias' }],
        },
      ]);

      expect(() => extractDependencies(project))
        .to.throw(SfError)
        .with.property('name', 'PackageAliasNotFoundError');
    });
  });

  describe('readSfdxProjectDependencies', () => {
    it('throws SfdxProjectNotFoundError when sfdx-project.json does not exist', async () => {
      try {
        await readSfdxProjectDependencies('/nonexistent/path/that/does/not/exist');
        expect.fail('Expected SfdxProjectNotFoundError');
      } catch (err) {
        expect(err).to.be.instanceOf(SfError);
        expect((err as SfError).name).to.equal('SfdxProjectNotFoundError');
      }
    });
  });
});
