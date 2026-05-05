#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Delete the three test packages (pool-test-a, pool-test-b, pool-test-c) from
 * the target DevHub and remove the generated root sfdx-project.json.
 *
 * Usage:
 *   node scripts/delete-test-packages.js --target-dev-hub <alias-or-username> --yes
 *
 * Without --yes the script runs in dry-run mode and only reports what would be
 * deleted. Tolerates partial state: missing packages or versions are skipped
 * with a warning rather than aborting the run.
 *
 * Cross-platform (Node.js, no shell-specific syntax).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = join(REPO_ROOT, 'sfdx-project.json');
const PACKAGE_NAMES = ['pool-test-a', 'pool-test-b', 'pool-test-c'];

function parseArgs(argv) {
  const args = { devhub: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target-dev-hub' || a === '-v') args.devhub = argv[++i];
    else if (a === '--yes' || a === '-y') args.yes = true;
  }
  return args;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.warn(`WARN:  ${msg}`);
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

function runSf(args, { allowFail = false } = {}) {
  const res = spawnSync('sf', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (res.error) fail(`Failed to invoke sf CLI: ${res.error.message}`);
  if (res.status !== 0 && !allowFail) {
    console.error(res.stdout);
    console.error(res.stderr);
    fail(`sf ${args.join(' ')} exited with code ${res.status}`);
  }
  return res;
}

function runSfJson(args, opts = {}) {
  const argsWithJson = args.includes('--json') ? args : [...args, '--json'];
  const res = runSf(argsWithJson, opts);
  if (!res.stdout) return null;
  try {
    return JSON.parse(res.stdout);
  } catch {
    return null;
  }
}

function listPackages(devhub) {
  const res = runSfJson(['package', 'list', '--target-dev-hub', devhub]);
  return res?.result ?? [];
}

function listPackageVersions(devhub) {
  const res = runSfJson(['package', 'version', 'list', '--target-dev-hub', devhub]);
  return res?.result ?? [];
}

function deleteVersion(devhub, subId, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] would delete version: ${subId}`);
    return;
  }
  console.log(`  - deleting version: ${subId}`);
  const res = runSf(['package', 'version', 'delete', '--package', subId, '--no-prompt', '--target-dev-hub', devhub], {
    allowFail: true,
  });
  if (res.status !== 0) warn(`could not delete version ${subId}; continuing`);
}

function deletePackage(devhub, packageId, name, dryRun) {
  if (dryRun) {
    console.log(`  [dry-run] would delete package: ${name} (${packageId})`);
    return;
  }
  console.log(`  - deleting package: ${name} (${packageId})`);
  const res = runSf(['package', 'delete', '--package', packageId, '--no-prompt', '--target-dev-hub', devhub], {
    allowFail: true,
  });
  if (res.status !== 0) warn(`could not delete package ${name}; continuing`);
}

async function main() {
  const { devhub, yes } = parseArgs(process.argv.slice(2));
  if (!devhub) {
    fail('Missing required argument: --target-dev-hub <alias-or-username>');
  }
  const dryRun = !yes;

  console.log(`Target DevHub : ${devhub}`);
  console.log(`Packages      : ${PACKAGE_NAMES.join(', ')}`);

  if (!yes) {
    const action = dryRun ? 'show what would be deleted (dry-run)' : 'delete these packages from this DevHub';
    const confirmed = await promptConfirm(`\nProceed to ${action}? [y/N] `);
    if (!confirmed) {
      console.log('Aborted.');
      process.exit(0);
    }
    console.log();
  }

  if (dryRun) {
    console.log('DRY-RUN mode (no changes). Pass --yes to actually delete.\n');
  } else {
    console.log(`Deleting test packages from DevHub "${devhub}".\n`);
  }

  const packages = listPackages(devhub);
  const versions = listPackageVersions(devhub);

  for (const name of PACKAGE_NAMES) {
    const pkg = packages.find((p) => p.Name === name);
    if (!pkg) {
      warn(`package "${name}" not found in DevHub; skipping.`);
      continue;
    }
    console.log(`Package: ${name} (${pkg.Id})`);
    const pkgVersions = versions.filter((v) => v.Package2Id === pkg.Id || v.Package2Name === name);
    for (const v of pkgVersions) {
      const subId = v.SubscriberPackageVersionId;
      if (!subId) continue;
      deleteVersion(devhub, subId, dryRun);
    }
    deletePackage(devhub, pkg.Id, name, dryRun);
  }

  if (!dryRun && existsSync(OUTPUT_PATH)) {
    console.log(`\nRemoving generated ${OUTPUT_PATH}`);
    rmSync(OUTPUT_PATH);
  } else if (dryRun && existsSync(OUTPUT_PATH)) {
    console.log(`\n[dry-run] would remove ${OUTPUT_PATH}`);
  }

  console.log('\nDone.');
}

main();
