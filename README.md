# sf-cli-plugin-pool

A Salesforce CLI plugin for managing pools of pre-created scratch organizations. This plugin enables efficient CI/CD workflows by maintaining ready-to-use scratch orgs that can be allocated on-demand, significantly reducing validation and testing time.

## Core Commands

- **`sf pool prepare`** — Create and tag new scratch orgs to replenish pools (used by CI)
- **`sf pool fetch`** — Allocate an available scratch org from a pool (used by CI validation runs and developers)
- **`sf pool list`** — Display pool status: available/total/in-use counts (used by developers and platform team)
- **`sf pool clean`** — Remove failed, stale, or expired orgs from pools (used by CI jobs and platform team)

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
These must exist before using the plugin (SOQL against a missing field fails):

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

```
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
├── commands/pool/     # CLI command implementations (to be created)
├── lib/               # Shared business logic (to be created)
└── types/             # TypeScript interfaces

test/                  # Unit tests matching src/ structure
messages/              # User-facing strings (Markdown files with # key headers)
config/                # Example pool configuration files
```

> **Note:** This is a new project. The `src/commands/hello/` directory contains auto-generated examples that demonstrate the command, test, and message patterns. Pool commands will replace these as the project develops.

## SBOM (Software Bill of Materials)

A CycloneDX SBOM is generated for each build on the main branch:

- **Generation:** `pnpm dlx @cyclonedx/cdxgen` runs during CI
- **Filename:** `sbom.cyclonedx.json`
- **Availability:** Uploaded as a build artifact and included in package distributions
- **Location in builds:** Download from the "sbom" workflow artifact on main builds
- **Location in package:** Included in the distribution tarball under root directory

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

Bare-bones approach: avoid adding dependencies unless absolutely necessary.

## Questions

Questions related to the code or repository can be submitted as issues here on GitHub.

### For Nav employees

Internal inquiries can be sent via Slack in the #platforce channel.
