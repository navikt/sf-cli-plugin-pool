#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Set up the three test packages (pool-test-a, pool-test-b, pool-test-c) in the
 * target DevHub and generate the root sfdx-project.json from the committed template.
 *
 * Usage:
 *   node scripts/setup-test-packages.js --target-dev-hub <alias-or-username>
 *   node scripts/setup-test-packages.js --target-dev-hub <alias-or-username> --dry-run
 *
 * The script is idempotent:
 *   - Existing package definitions are reused (matched by Name).
 *   - A new released package version is created for each package only if one is
 *     not already available.
 *   - With --dry-run, the script reports what it would create without changing
 *     the DevHub or writing sfdx-project.json.
 *
 * Cross-platform (Node.js, no shell-specific syntax). Required by the
 * windows-latest runner in CI.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEST_PACKAGES_DIR = join(REPO_ROOT, 'test-packages');
const TEMPLATE_PATH = join(TEST_PACKAGES_DIR, 'sfdx-project.json.template');
const OUTPUT_PATH = join(REPO_ROOT, 'sfdx-project.json');

const PACKAGE_NAMES = ['pool-test-a', 'pool-test-b', 'pool-test-c'];
const EXTERNAL_PACKAGE_NAME = 'pool-test-c';
const PLACEHOLDER = {
  'pool-test-a': '{{POOL_TEST_A_ID}}',
  'pool-test-b': '{{POOL_TEST_B_ID}}',
  'pool-test-c': '{{POOL_TEST_C_ID}}',
};

function parseArgs(argv) {
  const args = { devhub: null, yes: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target-dev-hub' || a === '-v') {
      args.devhub = argv[++i];
    } else if (a === '--yes' || a === '-y') {
      args.yes = true;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
}

async function promptConfirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function runSf(args, { cwd = REPO_ROOT, allowFail = false } = {}) {
  const result = spawnSync('sf', args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.error) {
    fail(`Failed to invoke sf CLI: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFail) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail(`sf ${args.join(' ')} exited with code ${result.status}`);
  }
  return result;
}

function runSfJson(args, opts = {}) {
  const argsWithJson = args.includes('--json') ? args : [...args, '--json'];
  const res = runSf(argsWithJson, opts);
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    console.error(res.stdout);
    fail(`Failed to parse JSON output of: sf ${argsWithJson.join(' ')}`);
    return null;
  }
}

function ensureDevHubReachable(devhub) {
  console.log(`Verifying DevHub access for "${devhub}"...`);
  runSfJson(['org', 'display', '--target-org', devhub]);
  console.log('DevHub reachable.');
}

function listPackages(devhub) {
  const res = runSfJson(['package', 'list', '--target-dev-hub', devhub]);
  return res?.result ?? [];
}

function findPackageInList(packages, name) {
  const wanted = name.toLowerCase();
  return packages.find((pkg) => {
    const pkgName = (pkg.Name ?? pkg.Package2Name ?? '').toLowerCase();
    return pkgName === wanted;
  });
}

function findPackageInDevHub(devhub, name) {
  const escapedName = name.replaceAll("'", "\\'");
  const res = runSfJson([
    'data',
    'query',
    '--use-tooling-api',
    '--query',
    `SELECT Id, Name FROM Package2 WHERE Name = '${escapedName}' LIMIT 1`,
    '--target-org',
    devhub,
  ]);
  const records = res?.result?.records ?? [];
  return records[0] ?? null;
}

function listPackageVersions(devhub) {
  const res = runSfJson(['package', 'version', 'list', '--target-dev-hub', devhub, '--released']);
  return res?.result ?? [];
}

function ensurePackageDefinition(devhub, name, packages, { dryRun = false } = {}) {
  const fromList = findPackageInList(packages, name);
  if (fromList?.Id) {
    console.log(`  - Package definition already exists: ${name} (${fromList.Id})`);
    return fromList.Id;
  }

  const fromQuery = findPackageInDevHub(devhub, name);
  if (fromQuery?.Id) {
    console.log(`  - Package definition already exists: ${name} (${fromQuery.Id})`);
    return fromQuery.Id;
  }

  if (dryRun) {
    console.log(`  - Package definition missing: ${name} (dry-run: would create)`);
    return null;
  }

  console.log(`  - Creating package definition: ${name}`);
  const res = runSfJson(
    [
      'package',
      'create',
      '--name',
      name,
      '--package-type',
      'Unlocked',
      '--path',
      join('test-packages', name),
      '--no-namespace',
      '--target-dev-hub',
      devhub,
    ],
    { cwd: REPO_ROOT }
  );
  const id = res?.result?.Id;
  if (!id) fail(`Could not determine package Id for ${name}`);
  console.log(`    created Package2Id: ${id}`);
  return id;
}

function ensurePackageVersion(devhub, name, packageId, versions, { dryRun = false } = {}) {
  const existing = versions.find((v) => v.Package2Name === name || v.Package2Id === packageId);
  if (existing && existing.SubscriberPackageVersionId) {
    console.log(
      `  - Released version exists for ${name}: ${existing.SubscriberPackageVersionId} (${existing.Version})`
    );
    return existing.SubscriberPackageVersionId;
  }

  if (dryRun) {
    console.log(`  - Released version missing for ${name} (dry-run: would create)`);
    return null;
  }

  console.log(`  - Creating package version for: ${name}`);
  const res = runSfJson(
    [
      'package',
      'version',
      'create',
      '--path',
      join('test-packages', name),
      '--installation-key-bypass',
      '--wait',
      '20',
      '--target-dev-hub',
      devhub,
    ],
    { cwd: REPO_ROOT }
  );
  const subId = res?.result?.SubscriberPackageVersionId;
  if (!subId) fail(`Could not determine SubscriberPackageVersionId for ${name}`);
  console.log(`    created SubscriberPackageVersionId: ${subId}`);
  return subId;
}

function promotePackageVersion(devhub, subscriberPackageVersionId, { dryRun = false } = {}) {
  if (!subscriberPackageVersionId) {
    return;
  }

  if (dryRun) {
    console.log(`  - Dry-run: would promote version ${subscriberPackageVersionId} to released`);
    return;
  }

  console.log(`  - Promoting version ${subscriberPackageVersionId} to released`);
  runSf(
    [
      'package',
      'version',
      'promote',
      '--package',
      subscriberPackageVersionId,
      '--no-prompt',
      '--target-dev-hub',
      devhub,
    ],
    { allowFail: true }
  );
}

function renderTemplate(idMap, { dryRun = false } = {}) {
  let template;
  try {
    template = readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (e) {
    fail(`Could not read template at ${TEMPLATE_PATH}: ${e.message}`);
  }
  for (const [name, id] of Object.entries(idMap)) {
    if (!id) {
      continue;
    }
    template = template.split(PLACEHOLDER[name]).join(id);
  }

  if (dryRun) {
    console.log(`\nDry-run: would write ${OUTPUT_PATH}`);
    return;
  }

  writeFileSync(OUTPUT_PATH, template, 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

function ensureProjectFile(packageIds = {}, { dryRun = false } = {}) {
  let template;
  try {
    template = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  } catch (e) {
    fail(`Could not build bootstrap project file from ${TEMPLATE_PATH}: ${e.message}`);
  }

  const bootstrap = {
    ...template,
    packageAliases: {
      ...(template.packageAliases ?? {}),
      ...packageIds,
    },
    packageDirectories: [
      ...PACKAGE_NAMES.map((name, index) => ({
        path: join('test-packages', name).replaceAll('\\', '/'),
        package: packageIds[name] ?? name,
        versionName: '0.1.0',
        versionNumber: '0.1.0.NEXT',
        default: index === 0,
      })),
    ],
  };

  if (dryRun) {
    console.log(`\nDry-run: would prepare ${OUTPUT_PATH} for package version creation.`);
    return;
  }

  try {
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(bootstrap, null, 2)}\n`, 'utf8');
  } catch (e) {
    fail(`Could not write bootstrap project file at ${OUTPUT_PATH}: ${e.message}`);
  }

  console.log(`\nPrepared ${OUTPUT_PATH} for package version creation.`);
}

async function main() {
  const { devhub, yes, dryRun } = parseArgs(process.argv.slice(2));
  if (!devhub) {
    fail('Missing required argument: --target-dev-hub <alias-or-username>');
  }

  console.log(`Target DevHub : ${devhub}`);
  console.log(`Packages      : ${PACKAGE_NAMES.join(', ')}`);
  if (dryRun) {
    console.log('Mode          : dry-run');
  }

  if (!yes && !dryRun) {
    const confirmed = await promptConfirm('\nProceed with creating/updating these packages in this DevHub? [y/N] ');
    if (!confirmed) {
      console.log('Aborted.');
      process.exit(0);
    }
  }

  ensureDevHubReachable(devhub);

  console.log('\nListing existing packages and versions in DevHub...');
  const packages = listPackages(devhub);
  const versions = listPackageVersions(devhub);

  const packageIds = {};
  const subscriberIds = {};

  console.log('\nEnsuring package definitions...');
  for (const name of PACKAGE_NAMES) {
    const pkgId = ensurePackageDefinition(devhub, name, packages, { dryRun });
    packageIds[name] = pkgId;
  }

  ensureProjectFile(packageIds, { dryRun });

  console.log('\nEnsuring package versions...');
  for (const name of PACKAGE_NAMES) {
    const pkgId = packageIds[name];
    const subId = ensurePackageVersion(devhub, name, pkgId, versions, { dryRun });
    subscriberIds[name] = subId;
  }

  // Promote pool-test-c so its 04t becomes a released version usable as a
  // direct identifier (exercises the non-SOQL resolution path in packageInstaller).
  promotePackageVersion(devhub, subscriberIds[EXTERNAL_PACKAGE_NAME], { dryRun });

  // Internal packages use their 0Ho Package2Id (resolved via DevHub SOQL at install time).
  // External package uses the 04t SubscriberPackageVersionId directly.
  const idMap = {
    'pool-test-a': packageIds['pool-test-a'],
    'pool-test-b': packageIds['pool-test-b'],
    'pool-test-c': subscriberIds['pool-test-c'],
  };

  console.log('\nResolved IDs:');
  for (const name of PACKAGE_NAMES) {
    const resolvedId = idMap[name] ?? 'pending package version creation';
    console.log(`  ${name}: ${resolvedId}`);
  }

  renderTemplate(idMap, { dryRun });
  if (dryRun) {
    console.log('\nDone. Dry-run completed with no changes.');
    return;
  }

  console.log('\nDone. Test packages are ready and sfdx-project.json is generated.');
}

main();
