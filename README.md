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

```
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
./bin/dev pool list
```

Or link the plugin to the Salesforce CLI:

```bash
sf plugins link .
sf plugins  # verify
sf pool list
```

## Dependencies

- **@salesforce/core** — Auth, Config, Logger, SfError, Org
- **@salesforce/sf-plugins-core** — SfCommand base class
- **@oclif/core** — Underlying CLI framework (abstracted by sf-plugins-core)

Bare-bones approach: avoid adding dependencies unless absolutely necessary.

## Questions

Questions related to the code or repository can be submitted as issues here on GitHub.

### For Nav employees

Internal inquiries can be sent via Slack in the #platforce channel.
