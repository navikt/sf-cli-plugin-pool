---
applyTo: 'scripts/**'
---

# Repository Scripts

Cross-platform Node.js scripts for managing the local test environment. Both scripts must remain Node.js (not bash) so they run on the `windows-latest` CI runner.

## `scripts/setup-test-packages.js`

**Purpose:** Ensure the three test packages (`pool-test-a`, `pool-test-b`, `pool-test-c`) exist in the target DevHub and generate the root `sfdx-project.json` from `test-packages/sfdx-project.json.template`.

**Usage:**

```bash
node scripts/setup-test-packages.js --target-dev-hub <alias-or-username>
# or
pnpm run setup:test-packages -- --target-dev-hub <alias-or-username>
```

**Behavior:**

1. Verifies DevHub access via `sf org display`.
2. Lists existing packages and released versions in the DevHub.
3. For each test package: creates the package definition if missing (idempotent by `Name`), then creates a released version if no released version exists.
4. Promotes `pool-test-c` so its `04t` is usable as a direct SubscriberPackageVersionId (exercises the non-SOQL resolution path in [`src/lib/packageInstaller.ts`](../../src/lib/packageInstaller.ts)).
5. Copies `test-packages/sfdx-project.json.template`, renders the resolved IDs, and writes to root `sfdx-project.json`.

**ID strategy:**

- `pool-test-a`, `pool-test-b` → `0Ho` Package2Id (resolved via DevHub SOQL at install time)
- `pool-test-c` → `04t` SubscriberPackageVersionId (used directly)

## `scripts/delete-test-packages.js`

**Purpose:** Remove the three test packages and clear the generated root `sfdx-project.json`.

**Usage:**

```bash
node scripts/delete-test-packages.js --target-dev-hub <alias-or-username> --yes
# or
pnpm run delete:test-packages -- --target-dev-hub <alias-or-username> --yes
```

Without `--yes` the script runs in dry-run mode and only reports what would be deleted. Tolerates partial state (missing packages or versions are skipped with a warning).

## Conventions

- Pure Node.js, ESM, no third-party dependencies.
- Use `spawnSync('sf', ...)` to invoke the Salesforce CLI; never construct shell pipelines.
- `--target-dev-hub` is required for both scripts.
- `--yes` is required for destructive actions in the delete script.
- Keep both scripts at the repository root level under `scripts/`.

## Related

- Generated file: root `sfdx-project.json` (gitignored).
- Template: `test-packages/sfdx-project.json.template` (committed).
- Test package source: `test-packages/`.
- CI integration: `.github/workflows/test.yml` runs setup before NUTs.
- Contributor walkthrough: `README.md` "Local Test Environment Setup".
