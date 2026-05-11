#!/usr/bin/env node
/* eslint-disable no-console */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEST_PACKAGES_DIR = join(REPO_ROOT, 'test-packages');
const TEMPLATE_PATH = join(TEST_PACKAGES_DIR, 'sfdx-project.json.template');
const OUTPUT_PATH = join(REPO_ROOT, 'sfdx-project.json');

const PACKAGE_NAMES = ['pool-test-a', 'pool-test-b', 'pool-test-c'];
const PLACEHOLDER = {
  'pool-test-a': '{{POOL_TEST_A_ID}}',
  'pool-test-b': '{{POOL_TEST_B_ID}}',
  'pool-test-c': '{{POOL_TEST_C_ID}}',
};

function parseArgs(argv) {
  const args = { devhub: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target-dev-hub' || a === '-v') {
      args.devhub = argv[++i];
    } else if (a === '--dry-run') {
      args.dryRun = true;
    }
  }
  return args;
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
  } catch {
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

function queryPackageId(devhub, name) {
  const escapedName = name.replaceAll("'", "\\'");
  const res = runSfJson([
    'data',
    'query',
    '--use-tooling-api',
    '--query',
    `SELECT Id, Name, CreatedDate FROM Package2 WHERE Name = '${escapedName}' AND IsDeprecated = false ORDER BY CreatedDate DESC LIMIT 1`,
    '--target-org',
    devhub,
  ]);

  const records = res?.result?.records ?? [];
  if (!records[0]?.Id) {
    fail(`No active package definition found for '${name}' in DevHub '${devhub}'.`);
  }
  return records[0].Id;
}

function listPackageVersions(devhub) {
  const res = runSfJson(['package', 'version', 'list', '--target-dev-hub', devhub]);
  return res?.result ?? [];
}

function resolveSubscriberId(name, packageId, versions) {
  const matches = versions.filter(
    (v) => (v.Package2Name === name || v.Package2Id === packageId) && Boolean(v.SubscriberPackageVersionId)
  );
  const selected = matches.find((v) => v.IsReleased === true) ?? matches[0];

  if (!selected?.SubscriberPackageVersionId) {
    fail(`No package version found for '${name}' (${packageId}).`);
  }

  return {
    id: selected.SubscriberPackageVersionId,
    isReleased: selected.IsReleased === true,
  };
}

function renderTemplate(idMap, { dryRun = false } = {}) {
  let template;
  try {
    template = readFileSync(TEMPLATE_PATH, 'utf8');
  } catch (e) {
    fail(`Could not read template at ${TEMPLATE_PATH}: ${e.message}`);
  }

  for (const [name, id] of Object.entries(idMap)) {
    template = template.split(PLACEHOLDER[name]).join(id);
  }

  if (dryRun) {
    console.log(`\nDry-run: would write ${OUTPUT_PATH}`);
    return;
  }

  writeFileSync(OUTPUT_PATH, template, 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

function main() {
  const { devhub, dryRun } = parseArgs(process.argv.slice(2));
  if (!devhub) {
    fail('Missing required argument: --target-dev-hub <alias-or-username>');
  }

  console.log(`Target DevHub : ${devhub}`);
  console.log(`Packages      : ${PACKAGE_NAMES.join(', ')}`);
  if (dryRun) {
    console.log('Mode          : dry-run');
  }

  ensureDevHubReachable(devhub);

  const packageIds = {};
  console.log('\nResolving package definitions...');
  for (const name of PACKAGE_NAMES) {
    const pkgId = queryPackageId(devhub, name);
    packageIds[name] = pkgId;
    console.log(`  - ${name}: ${pkgId}`);
  }

  console.log('\nResolving package versions...');
  const versions = listPackageVersions(devhub);
  const subscriberIds = {};
  for (const name of PACKAGE_NAMES) {
    const resolved = resolveSubscriberId(name, packageIds[name], versions);
    subscriberIds[name] = resolved.id;
    const releaseLabel = resolved.isReleased ? 'released' : 'unreleased';
    console.log(`  - ${name}: ${resolved.id} (${releaseLabel})`);
  }

  const idMap = {
    'pool-test-a': packageIds['pool-test-a'],
    'pool-test-b': packageIds['pool-test-b'],
    'pool-test-c': subscriberIds['pool-test-c'],
  };

  console.log('\nResolved IDs for template:');
  for (const name of PACKAGE_NAMES) {
    console.log(`  ${name}: ${idMap[name]}`);
  }

  renderTemplate(idMap, { dryRun });

  if (dryRun) {
    console.log('\nDone. Dry-run completed with no changes.');
    return;
  }

  console.log('\nDone. Resolved IDs and generated sfdx-project.json.');
}

main();
