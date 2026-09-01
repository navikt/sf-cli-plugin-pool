# sf-cli-plugin-pool

A Salesforce CLI plugin for managing pools of pre-created scratch organizations. This plugin enables efficient CI/CD workflows by maintaining ready-to-use scratch orgs that can be allocated on-demand, significantly reducing validation and testing time.

## Table of Contents

- [Installation](#installation)
- [Core Commands](#core-commands)
- [Diagnostics](#diagnostics-sf-doctor)
- [Pool Configuration](#pool-configuration)
- [DevHub Requirements](#devhub-requirements)
- [SBOM](#sbom-software-bill-of-materials)
- [Releasing](#releasing)
- [Development](#development)
- [Local Test Environment Setup](#local-test-environment-setup)
- [CI Setup](#ci-setup)
- [Dependencies](#dependencies)
- [Questions](#questions)

## Installation

The published plugin is available from GitHub Packages. You need access to the `navikt` GitHub organization and a GitHub personal access token with `read:packages` permission.

Configure npm to use GitHub Packages for the `@navikt` scope. Packages outside that scope continue to be downloaded from the public npm registry:

```bash
npm config set registry https://registry.npmjs.org/
npm config set @navikt:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken '${GITHUB_TOKEN}'
```

Set `GITHUB_TOKEN` to your token in the shell before installing. npm expands the environment variable when it accesses the registry, so the token itself is not written to your npm configuration. Do not commit a real token to a configuration file.

Install the plugin through the Salesforce CLI:

```bash
sf plugins install @navikt/sf-cli-plugin-pool
sf plugins
```

## Core Commands

- **`sf pool prepare`** — Create and tag new scratch orgs to replenish pools (used by CI)
- **`sf pool fetch`** — Allocate an available scratch org from a pool (used by CI validation runs and developers)
- **`sf pool list`** — Display pool status: available/total/in-use counts (used by developers and platform team)
- **`sf pool clean`** — Remove failed, stale, or expired orgs from pools (used by CI jobs and platform team)

## Diagnostics (`sf doctor`)

This plugin registers diagnostic tests with the standard `sf doctor` command. There is no separate `sf pool doctor` subcommand — the checks run automatically when you invoke:

```bash
sf doctor
```

The plugin verifies:

- **Default DevHub configured** — a `target-dev-hub` is set and resolvable via `sf config`.
- **`Pool_tag__c` accessible** — the custom field exists and is readable on `ScratchOrgInfo` in the DevHub.
- **`Pool_allocation_status__c` accessible** — same.
- **`Sfdx_Auth_Url__c` accessible** — same.
- **`Pool_claim_token__c` accessible** — same.

Each check emits a `pass`, `fail`, `warn`, or `unknown` result. On failure or warning, `sf doctor` outputs a remediation suggestion pointing back to the [DevHub Requirements](#devhub-requirements) section below.

> **Note:** The diagnostics do not verify the claim-token validation rule, scratch-org limits, or the pool config file — those require elevated access or are relevant only to pool creators.

## Pool Configuration

Pools are defined via JSON config files:

```json
{
  "pools": [
    {
      "tag": "pool-name",
      "count": 10,
      "definitionFilePath": "config/project-scratch-def.json",
      "retryCount": 3,
      "expirationDays": 7
    }
  ]
}
```

## DevHub Requirements

Pool state is tracked via custom fields on the standard **`ScratchOrgInfo`** object in the DevHub.
These must exist before using the plugin (SOQL against a missing field fails).
Run `sf doctor` to verify that these fields are present and accessible before running pool commands.

| Field                       | Type                                                                        | Purpose                                                                          |
| --------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Pool_tag__c`               | Text                                                                        | Identifies which pool an org belongs to                                          |
| `Pool_allocation_status__c` | Picklist (`in_progress`, `available`, `under_update`, `failed`, `assigned`) | Tracks org lifecycle status                                                      |
| `Sfdx_Auth_Url__c`          | Text (Long/255)                                                             | Stores the SFDX auth URL so `pool fetch` can authenticate; cleared on assignment |
| `Pool_claim_token__c`       | Text (255)                                                                  | Per-fetch claim token used to make `pool fetch` safe under concurrency           |

### Concurrency: claim-token validation rule (required)

`sf pool fetch` is designed to be called by many CI jobs in parallel. To prevent two concurrent
fetches from claiming the same org, each fetch writes a unique token into `Pool_claim_token__c`.
A **validation rule** on `ScratchOrgInfo` must reject any attempt to overwrite a token that is
already set with a different value. Salesforce serializes concurrent updates to the same record, so
this makes the claim **first-writer-wins**: exactly one fetch succeeds and the rest receive a
`FIELD_CUSTOM_VALIDATION_EXCEPTION`, which the plugin treats as "lost the race" and retries against
another org.

Create a validation rule (e.g. `Pool_claim_token_immutable`) with this error condition formula:

```text
AND(
  NOT(ISBLANK(PRIORVALUE(Pool_claim_token__c))),
  NOT(ISBLANK(Pool_claim_token__c)),
  PRIORVALUE(Pool_claim_token__c) <> Pool_claim_token__c
)
```

This allows the initial claim (blank → value) and recycling/cleanup (value → blank), but rejects
changing a non-blank token to a different non-blank value. The plugin keys on the
`FIELD_CUSTOM_VALIDATION_EXCEPTION` status code, so the rule's error message text is not significant.

> **Without this validation rule the concurrency guarantee does not hold** — concurrent fetches
> could hand the same scratch org to multiple consumers.

### Ownership transfer on fetch

When `sf pool fetch` claims an org, it transfers ownership to the user running the command (the
authenticated DevHub user): `OwnerId` is set on the winning `ScratchOrgInfo` record (as part of the
atomic claim) and on the related `ActiveScratchOrg` record. The running user must therefore have
permission to update `OwnerId` on both objects; an ownership-transfer failure aborts the fetch.

```txt
src/
├── commands/pool/     # CLI command implementations
├── lib/               # Shared business logic
└── types/             # TypeScript interfaces

test/                  # Unit tests matching src/ structure
messages/              # User-facing strings (Markdown files with # key headers)
config/                # Example pool configuration files
```

## SBOM (Software Bill of Materials)

A CycloneDX SBOM is generated for each build on the main branch:

- **Generation:** `pnpm dlx @cyclonedx/cdxgen` runs during CI
- **Filename:** `sbom.cyclonedx.json`
- **Availability:** Uploaded as a build artifact and included in package distributions
- **Location in builds:** Download from the "sbom" workflow artifact on main builds
- **Location in package:** Included in the distribution tarball under root directory

## Releasing

Releases are automated with [release-please](https://github.com/googleapis/release-please) and published to GitHub Packages. Versioning is driven entirely by [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint).

### How it works

1. **Every push to `main`** runs [.github/workflows/release-please.yml](.github/workflows/release-please.yml). It scans the conventional-commit history and maintains a **release PR** that bumps the version in `package.json`, updates `CHANGELOG.md`, and syncs `.release-please-manifest.json`.
2. **Merging the release PR** makes release-please create the git tag and a **GitHub Release**.
3. The published release triggers [.github/workflows/release.yml](.github/workflows/release.yml), which runs the tests and publishes the package to GitHub Packages (`@navikt` scope) via `prepack` (build + oclif manifest + SBOM).

The release-please workflow authenticates with a **GitHub App token** (not the default `GITHUB_TOKEN`). This is required: releases created by `GITHUB_TOKEN` do not trigger other workflows, so the publish step would never run.

### Version bumps

| Commit type                          | Result            |
| ------------------------------------ | ----------------- |
| `fix:`                               | patch (x.y.**z**) |
| `feat:`                              | minor (x.**y**.z) |
| `feat!:` / `BREAKING CHANGE:` footer | major (**x**.y.z) |

### State files

- `.release-please-manifest.json` — the **source of truth** for the last released version. `0.0.0` means nothing has been released yet.
- `release-please-config.json` — release configuration (`release-type: node`, changelog path).
- `CHANGELOG.md` — generated and maintained by release-please on the first release.

### Cutting the first `1.0.0` release

From a `0.0.0` manifest, conventional commits alone would produce `0.1.0`. To force the first tagged release to be exactly `1.0.0`, land a commit with a `Release-As` footer on `main`:

```bash
git commit --allow-empty -m "chore: release 1.0.0" -m "Release-As: 1.0.0"
git push
```

release-please will then open a release PR targeting `1.0.0`. Merge it to tag and publish. After that, versions follow the table above.

## Development

### Prerequisites

- Node.js >= 18
- pnpm

### Setup

```bash
pnpm install
pnpm run build
```

### Testing

```bash
pnpm test             # Compile + lint + unit tests
pnpm run test:only    # Unit tests only
pnpm run test:nuts    # Integration tests (requires DevHub auth)
```

### Linting & Formatting

```bash
pnpm run lint
pnpm run format
```

### Local Usage

Run commands using the local dev file:

```bash
./bin/dev.js pool list
```

Or link the plugin to the Salesforce CLI:

```bash
sf plugins link .
sf plugins  # verify
sf pool list
sf doctor   # verify the diagnostics hook is registered and pool fields are accessible
```

## Local Test Environment Setup

NUTs and most manual `pool prepare` runs require three test packages to exist in your DevHub. The repository ships with a small Salesforce package workspace under `test-packages/` and two scripts for generating root `sfdx-project.json` (gitignored):

- `setup:test-packages` for bootstrapping missing packages/versions
- `resolve:package-ids` for environments where packages/versions already exist

### Test Environment Prerequisites

- A Salesforce org with **Dev Hub enabled** (Setup → Dev Hub → Enable Dev Hub)
- `sf` CLI in PATH
- Authenticated DevHub: `sf org login web --set-default-dev-hub --alias my-devhub`

### About the test packages

Three test packages are maintained under `test-packages/`:

- **`pool-test-a`** and **`pool-test-b`**: Local unlocked packages. Their Package2 IDs (`0Ho...`) are resolved and embedded in the root `sfdx-project.json`.
- **`pool-test-c`**: Simulates an externally-managed package using its SubscriberPackageVersionId (`04t...`), as if it were installed from AppExchange or another source. This tests dependency resolution for packages referenced by their version ID rather than a local package definition.

All three are created and versioned in the DevHub during setup.

### How this relates to `pool-example.json`

`config/pool-example.json` defines pool metadata only (`tag`, `count`, retries, expiration) and points to `config/project-scratch-def.json` via `definitionFilePath`.

The package dependency behavior comes from the generated root `sfdx-project.json` (created by setup scripts), not from `pool-example.json` itself:

- `pool-example.json`: declares which pools to maintain and which scratch-def file to use
- `project-scratch-def.json`: scratch org shape/features
- root `sfdx-project.json`: package alias/dependency resolution used during org creation

This is why manual `pool prepare` and NUT runs require the three test packages first, even though `pool-example.json` does not list packages directly.

### Setup path A: bootstrap packages and versions

```bash
pnpm install
pnpm run setup:test-packages -- --target-dev-hub my-devhub
```

Preview the bootstrap run without creating packages, versions, or a root `sfdx-project.json`:

```bash
pnpm run setup:test-packages -- --target-dev-hub my-devhub --dry-run
```

This script will:

1. Verify access to the DevHub
2. Create the three packages (`pool-test-a`, `pool-test-b`, `pool-test-c`) if missing
3. Create a package version per package if one is not already available
4. Copy `test-packages/sfdx-project.json.template` to root and render aliases into `sfdx-project.json` (`0Ho...` for `pool-test-a`/`pool-test-b`, `04t...` for `pool-test-c`)

The script is idempotent — running it again reuses existing packages and versions.
Use `--dry-run` to verify what would be created before making changes in the DevHub.

### Setup path B: resolve IDs from existing packages only

If your DevHub already contains `pool-test-a`, `pool-test-b`, and `pool-test-c` with package versions, use:

```bash
pnpm run resolve:package-ids -- --target-dev-hub my-devhub
```

Preview without writing root `sfdx-project.json`:

```bash
pnpm run resolve:package-ids -- --target-dev-hub my-devhub --dry-run
```

The resolve script is strict: it fails if a package definition or package version is missing.

### Manual validation

```bash
./bin/dev.js pool list --target-dev-hub my-devhub
./bin/dev.js pool prepare --config-file config/pool-example.json --target-dev-hub my-devhub
```

### Run NUTs

```bash
pnpm run test:nuts
```

### Cleanup

This repository no longer provides a teardown script for package/package-version deletion. In many Salesforce environments those deletions are blocked or restricted. If you need cleanup, remove package versions and package definitions manually in your DevHub.

### CI behavior

The GitHub Actions NUT job authenticates via JWT using the `TESTKIT_*` secrets and runs `setup-test-packages.js` automatically before NUTs. There is no CI teardown — package definitions persist in the DevHub between runs (the setup is idempotent). See [.github/workflows/test.yml](.github/workflows/test.yml).

## CI Setup

NUTs (`pnpm run test:nuts`) run against a live Salesforce DevHub. This section documents how to set up the required infrastructure for CI.

### 1. Generate a certificate and private key

The JWT authentication flow requires an RSA key pair. Use PKCS1 format (`-traditional`) so that the testkit library handles it correctly on all platforms:

```bash
openssl genrsa -traditional -out server.key 2048
openssl req -new -x509 -key server.key -out server.crt -days 365 -subj "/CN=sf-cli-plugin-pool-nut"
```

Keep `server.key` — it becomes the `TESTKIT_JWT_KEY` secret. `server.crt` is uploaded to the External Client App.

### 2. Create or reuse a Permission Set

The CI user needs access to scratch org infrastructure. You can reuse an existing Permission Set in your DevHub org if it already grants these permissions, or create a new one.

Requires Dev Hub to be enabled first: Setup → Dev Hub → **Enable Dev Hub**.

The Permission Set needs the following object permissions:

- **Object Settings → Scratch Org Infos** → Read, Create, Edit, Delete
- **Object Settings → Active Scratch Orgs** → Read, Edit, Delete

### 3. Create an External Client App in Salesforce

In the DevHub org:

1. Setup → **External Client App Manager** → **New External Client App**
2. Fill in basic details, then enable **Enable OAuth Settings**
3. Enable **Use digital signatures** → upload `server.crt`
4. Add OAuth scopes: **Manage user data via APIs (api)** and **Perform requests at any time (refresh_token, offline_access)**
5. Save, then open the app → **Edit Policies** → set Permitted Users to **Admin approved users are pre-authorized**
6. Under **Permission Sets**, add the Permission Set created in step 2
7. Note the **Consumer Key** — this becomes `TESTKIT_JWT_CLIENT_ID`

### 4. Create a CI user with the correct permissions

1. Create a user (or use an existing integration user) in the DevHub org
2. Assign the Permission Set from step 2 to the CI user

### 5. Set GitHub Actions secrets

| Secret                  | Value                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `TESTKIT_HUB_USERNAME`  | Login username of the CI user                                                                        |
| `TESTKIT_JWT_CLIENT_ID` | Consumer Key from the External Client App                                                            |
| `TESTKIT_JWT_KEY`       | Full contents of `server.key` (including header/footer lines)                                        |
| `TESTKIT_HUB_INSTANCE`  | Instance URL of the DevHub, e.g. `https://myorg.my.salesforce.com` or `https://login.salesforce.com` |

## Dependencies

- **@salesforce/core** — Auth, Config, Logger, SfError, Org
- **@salesforce/sf-plugins-core** — SfCommand base class
- **@oclif/core** — Underlying CLI framework (abstracted by sf-plugins-core)

Dev-only:

- **@salesforce/plugin-info** — Provides the `SfDoctor` type used by the diagnostics hook; not a runtime dependency.

Bare-bones approach: avoid adding dependencies unless absolutely necessary.

## Questions

Questions related to the code or repository can be submitted as issues here on GitHub.

### For Nav employees

Internal inquiries can be sent via Slack in the #platforce channel.
