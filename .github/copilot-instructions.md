# AI Coding Instructions for sf-cli-plugin-pool

A Salesforce CLI plugin for managing pools of pre-created scratch organizations.
For file-specific conventions, see `.github/instructions/` (scoped by `applyTo` patterns).

## Build, Test, and Lint

```bash
pnpm install                       # install dependencies
pnpm run build                     # compile + lint (via wireit)
pnpm run lint                      # ESLint on src/ and test/
pnpm run test:only                 # unit tests with coverage (c8 + mocha)
pnpm test                          # compile + lint + unit tests
```

Run a single test file:

```bash
npx mocha "test/commands/pool/list.test.ts"
```

NUTs (integration tests) require DevHub authentication and run in CI only:

```bash
pnpm run test:nuts
```

Pre-submit: `pnpm run lint` → `pnpm run test:only` → `pnpm run build` (all must pass).

Coverage thresholds: 75% lines/statements/functions/branches (enforced by c8, see `.c8rc`).

## Architecture

This is an **oclif-based Salesforce CLI plugin** (`sf pool <subcommand>`). Three layers:

```
src/commands/pool/   →  Thin CLI commands (flag parsing, output formatting)
src/lib/             →  Business logic (pool operations, SOQL queries, org lifecycle)
src/types/           →  Pure TypeScript type declarations (no runtime logic)
messages/            →  User-facing strings as Markdown files (loaded via @salesforce/core Messages)
test/                →  Mirrors src/ structure; unit tests (*.test.ts) and NUTs (*.nut.ts)
```

**Pool state** is tracked via two custom fields on `ScratchOrgInfo` in the DevHub:

- `Pool_tag__c` — identifies which pool an org belongs to
- `Pool_allocation_status__c` — picklist that tracks org status. Available values below, structured as `api_name` Label (description))
  - `in_progress` - In Progress (being prepared)
  - `available` - Available (ready to use)
  - `under_update` - Under Update (being updated with changes)
  - `failed` - Failed (preparation failed)
  - `assigned` - Assigned (checked out by a user)

Pool operations work by querying/updating these fields through the DevHub `Connection` using SOQL.

**Pool management lifecycle**:

1. **Prepare**: Parse JSON config → create scratch orgs in DevHub → tag with pool name
2. **Fetch**: Find available org → mark as allocated → return credentials
3. **List**: Query pool orgs → aggregate counts by pool/status → display
4. **Clean**: Query failed/stale/expired orgs → delete from DevHub

## Key Conventions

### Commands (`src/commands/`)

- Every command extends `SfCommand<ResultType>` from `@salesforce/sf-plugins-core`
- All user-facing strings come from message files — never hardcode text
- Flag names: kebab-case in CLI (`--pool-tag`), camelCase in code (`flags.poolTag`)
- Return typed result objects compatible with `--json` output
- Commands are thin: parse flags, call lib functions, format output
- Use `this.log()` for user output, `this.logToFile()` for debug/doctor logs
- Errors: `throw new SfError(messages.getMessage('error.key'))`

### Library code (`src/lib/`)

- Contains shared business logic used by multiple commands
- Use `Logger.childFromRoot('moduleName')` for logging (not `this.log()`)
- Accept dependencies as parameters (connections, config) for testability
- Export functions/classes explicitly — no default exports
- One module per domain concept

### Types (`src/types/`)

- Use `type` (not `interface`) for data shapes
- No default exports, no runtime logic
- One file per domain concept

### Messages (`messages/`)

- Markdown files: `messages/pool.<command>.md`
- `# heading` defines a message key; use `%s` for runtime placeholders
- Required keys: `summary`, `description`, `examples`, `flags.<name>.summary`
- Examples use EJS templates: `<%= config.bin %>` and `<%= command.id %>`

### Tests

- Mocha `describe`/`it` with Chai `expect` assertions
- Every test file uses `TestContext` for sandboxing and `stubSfCommandUx` for output capture
- Run commands via `CommandClass.run(['--flag', 'value'])`
- Use `$$.fakeConnectionRequest` to stub SOQL responses
- NUTs use `TestSession` and `execCmd` from `@salesforce/cli-plugins-testkit`

## Key Salesforce APIs

From `@salesforce/core` (inspect type definitions in `node_modules`):

- `Org` — Salesforce org connection. Use `Org.create()` with alias or username
- `Connection` — SOQL/API access via `org.getConnection()`
- `SfError` — standard error class for all thrown errors
- `Logger` — structured logging for lib code
- `AuthInfo` — authentication management

## Commit Conventions

Enforced by `commitlint` (conventional commits). Use the `conventional-commit` skill when generating commit messages.

**Scope**: command name or component (e.g., `pool:prepare`, `poolQuery`)
