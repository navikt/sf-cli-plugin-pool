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

## Project Structure

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

NUTs and most manual `pool prepare` runs require three test packages to exist in your DevHub. The repository ships with a small Salesforce package workspace under `test-packages/` and a script that creates the packages on demand and generates a `sfdx-project.json` (gitignored) at the repo root with the resolved package IDs.

### Test Environment Prerequisites

- A Salesforce org with **Dev Hub enabled** (Setup → Dev Hub → Enable Dev Hub)
- `sf` CLI in PATH
- Authenticated DevHub: `sf org login web --set-default-dev-hub --alias my-devhub`

### One-time setup

```bash
pnpm install
pnpm run setup:test-packages -- --target-dev-hub my-devhub
```

Preview the setup without creating packages, versions, or a root `sfdx-project.json`:

```bash
pnpm run setup:test-packages -- --target-dev-hub my-devhub --dry-run
```

The script will:

1. Verify access to the DevHub
2. Create the three packages (`pool-test-a`, `pool-test-b`, `pool-test-c`) if missing
3. Create a released package version per package if one is not already available
4. Promote `pool-test-c` so it is usable as a direct `04t` SubscriberPackageVersionId
5. Copy `test-packages/sfdx-project.json.template` to root and render the resolved IDs into `sfdx-project.json`

The script is idempotent — running it again reuses existing packages and versions.
Use `--dry-run` to verify what would be created before making changes in the DevHub.

### Manual validation

```bash
./bin/dev.js pool list --target-dev-hub my-devhub
./bin/dev.js pool prepare --config-file config/pool-example.json --target-dev-hub my-devhub
```

### Run NUTs

```bash
pnpm run test:nuts
```

### Teardown

```bash
pnpm run delete:test-packages -- --target-dev-hub my-devhub --yes
```

Without `--yes` the delete script runs in dry-run mode and only reports what it would remove. On success it also removes the generated root `sfdx-project.json`.

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
