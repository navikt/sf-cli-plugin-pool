---
applyTo: 'scripts/**'
---

# Repository Scripts

Cross-platform Node.js scripts for managing the local test environment. Scripts must remain Node.js (not bash) so they run on the `windows-latest` CI runner.

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
2. Lists existing packages and package versions in the DevHub.
3. For each test package: creates the package definition if missing (idempotent by `Name`), then creates a package version if no version exists.
4. Reuses released versions when available and falls back to unreleased versions when needed.
5. Copies `test-packages/sfdx-project.json.template`, renders the resolved IDs, and writes to root `sfdx-project.json`.

## `scripts/resolve-package-ids.js`

**Purpose:** Resolve IDs from existing test packages in the target DevHub and generate root `sfdx-project.json` without creating packages or versions.

**Usage:**

```bash
node scripts/resolve-package-ids.js --target-dev-hub <alias-or-username>
# or
pnpm run resolve:package-ids -- --target-dev-hub <alias-or-username>
```

**Behavior:**

1. Verifies DevHub access via `sf org display`.
2. Resolves package definitions for `pool-test-a`, `pool-test-b`, `pool-test-c`.
3. Resolves package versions for those packages (prefers released, falls back to unreleased).
4. Renders IDs into `test-packages/sfdx-project.json.template` and writes root `sfdx-project.json`.

This script is strict read-only resolution: it fails if required package definitions or package versions are missing.

**ID strategy:**

- `pool-test-a`, `pool-test-b` → `0Ho` Package2Id (resolved via DevHub SOQL at install time)
- `pool-test-c` → `04t` SubscriberPackageVersionId (used directly)

## Conventions

- Pure Node.js, ESM, no third-party dependencies.
- Use `spawnSync('sf', ...)` to invoke the Salesforce CLI; never construct shell pipelines.
- `--target-dev-hub` is required for setup and resolve scripts.
- Keep scripts at the repository root level under `scripts/`.

## Related

- Generated file: root `sfdx-project.json` (gitignored).
- Template: `test-packages/sfdx-project.json.template` (committed).
- Test package source: `test-packages/`.
- CI integration: `.github/workflows/test.yml` runs setup before NUTs.
- Contributor walkthrough: `README.md` "Local Test Environment Setup".
