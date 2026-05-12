---
name: local-environment
description: Set up the local Salesforce DevHub test environment (test packages, sfdx-project.json, NUT prerequisites).
---

# SKILL: Local Test Environment Setup

Use this skill when a contributor or maintainer needs to set up their local machine to run `sf pool` commands manually or to run NUTs (`pnpm run test:nuts`) against their own Salesforce DevHub.

## When to use

- The user asks how to set up the project for local testing.
- The user reports `PackageVersionNotFoundError`, `SfdxProjectNotFoundError`, "Package not found", or NUTs failing because of missing packages.
- The user wants to bootstrap or resolve test package IDs in their DevHub.
- The user needs to validate `pool prepare` end-to-end locally.

## Prerequisites to verify

Before running setup, confirm with the user (or check) that they have:

1. A Salesforce org with **Dev Hub enabled** (Setup → Dev Hub → Enable Dev Hub).
2. The `sf` CLI installed and on PATH.
3. The DevHub authenticated:
   ```bash
   sf org login web --set-default-dev-hub --alias my-devhub
   sf org display --target-org my-devhub
   ```
4. Node.js >= 18 and `pnpm` available.
5. `pnpm install` has been run in the repo.

## Setup paths

### Path A: bootstrap missing packages and versions

Run from the repository root:

```bash
pnpm run setup:test-packages -- --target-dev-hub my-devhub
```

This:

1. Verifies access to the DevHub.
2. Creates three packages in the DevHub if missing: `pool-test-a`, `pool-test-b`, `pool-test-c`.
3. Creates a package version for each package if one does not already exist.
4. Reuses released versions when available and falls back to unreleased versions when needed.
5. Copies `test-packages/sfdx-project.json.template` to the repository root and renders the resolved IDs into `sfdx-project.json`.

#### Test package types

The three test packages have different ID patterns in the generated `sfdx-project.json`:

- **`pool-test-a`** and **`pool-test-b`**: Local unlocked packages. Their Package2 IDs (`0Ho...`) are resolved and embedded as package aliases.
- **`pool-test-c`**: Simulates an externally-managed package using its SubscriberPackageVersionId (`04t...`). This tests dependency resolution for packages referenced by their version ID rather than a local package definition (e.g., packages installed from AppExchange).

### Path B: resolve IDs from existing packages only

Use this when your DevHub already has the three packages and package versions:

```bash
pnpm run resolve:package-ids -- --target-dev-hub my-devhub
```

Dry-run preview:

```bash
pnpm run resolve:package-ids -- --target-dev-hub my-devhub --dry-run
```

This path is strict and does not create packages or versions.

The script is idempotent and safe to re-run.

## Validate the setup

```bash
./bin/dev.js pool list --target-dev-hub my-devhub
./bin/dev.js pool prepare --config-file config/pool-example.json --target-dev-hub my-devhub
pnpm run test:nuts
```

### Running NUTs locally

NUT files use `TestSession.create({ devhubAuthStrategy: 'AUTO' })` for session isolation in CI. When running NUTs locally, testkit may not reliably reuse local org aliases without environment variables. To run `pnpm run test:nuts` locally, set the following environment variables (use the same credentials as your DevHub):

```bash
export TESTKIT_HUB_USERNAME=<devhub-username>
export TESTKIT_JWT_CLIENT_ID=<oauth-client-id>
export TESTKIT_JWT_KEY="<rsa-private-key>"
export TESTKIT_HUB_INSTANCE=https://login.salesforce.com
pnpm run test:nuts
```

Alternatively, modify the NUT session strategy to use local aliases (see `.github/instructions/nuts.instructions.md`).

## Cleanup

No repository teardown script is provided for deleting packages or package versions. If cleanup is required, remove artifacts manually in DevHub.

## Troubleshooting

| Symptom                                                | Likely cause                                            | Fix                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `DevHub org not found` / auth error                    | Wrong alias or expired auth                             | `sf org list`, then re-login with `sf org login web --set-default-dev-hub --alias <alias>` |
| `PackageVersionNotFoundError` during NUT or manual run | Setup script not run, or run against a different DevHub | Re-run `pnpm run setup:test-packages -- --target-dev-hub <alias>`                          |
| Resolve script fails with missing package/version      | DevHub lacks required test packages or package versions | Run bootstrap setup script once, then retry resolve                                        |
| `SfdxProjectNotFoundError`                             | Root `sfdx-project.json` was deleted or never generated | Re-run setup script                                                                        |
| Setup script: package version create timeout           | DevHub busy or limits hit                               | Re-run; the script is idempotent and will pick up where it left off                        |
| Setup script fails on Windows with bash error          | Must use the Node.js script (not a bash equivalent)     | Use `pnpm run setup:test-packages -- --target-dev-hub <alias>` exactly as shown            |

## Files involved

- `scripts/setup-test-packages.js` — bootstraps packages and renders the template
- `scripts/resolve-package-ids.js` — resolves IDs from existing packages and renders the template
- `test-packages/sfdx-project.json.template` — committed template with `{{POOL_TEST_*_ID}}` placeholders
- `sfdx-project.json` — generated, gitignored
- `test-packages/` — Salesforce package source for the three test packages
- `config/pool-example.json` — pool configuration used by manual runs and NUTs
- `.github/workflows/test.yml` — runs the setup script before NUTs in CI

## Related

- README section: "Local Test Environment Setup"
- Instructions: `.github/instructions/nuts.instructions.md`, `.github/instructions/scripts.instructions.md`
