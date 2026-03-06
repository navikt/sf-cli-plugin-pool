# AI Coding Instructions for sf-cli-plugin-pool

This file covers architecture, workflows, and design decisions.
For file-specific conventions, see `.github/instructions/` (scoped by `applyTo` patterns).
For build/test/CI commands, see `AGENTS.md`.

## Logging Strategy

See `.github/instructions/commands.instructions.md` for command logging and `.github/instructions/lib.instructions.md` for library logging.

## Critical Workflows

**Common command workflow**:

1. Parse flags/args (e.g., config file path, pool name, target org)
2. Validate inputs (error via `SfError` for invalid configs or missing orgs)
3. Load pool configuration from JSON file
4. Perform org operations (create/fetch/delete using DevHub context)
5. Log activity and return structured results (compatible with `--json` output)

**Pool management lifecycle**:

1. **Prepare**: Parse JSON config → validate pool specs → create orgs in DevHub → tag with pool name → persist pool state
2. **Fetch**: Load pool state → find available org → mark as allocated → return org credentials
3. **List**: Load pool state → aggregate counts by pool → display available/total/in-use status
4. **Clean**: Load pool state → delete failed/stale/expired orgs from DevHub → update pool state

**Doctor integration**:
Commands should register health checks that validate:

- DevHub org is accessible
- Pool configuration files are readable and valid JSON
- All tracked orgs still exist in DevHub (cleanup orphaned entries)

## Key Salesforce APIs

When implementing pool logic, explore these classes in `@salesforce/core` (inspect type definitions in node_modules):

- `Org` — represents a Salesforce org connection. Use `Org.create()` with an alias or username.
- `AuthInfo` — manages authentication. The DevHub is an authenticated org.
- `ScratchOrgCreate` / `scratchOrgCreate()` — creates scratch orgs from a definition file.
- `Connection` — low-level SOQL/API access. Use `org.getConnection()`.
- `SfError` — standard error class for all thrown errors.
- `Logger` — structured logging for lib code.
- `Config` / `ConfigFile` — local persistent key-value storage.

Pool state is tracked by tagging scratch orgs with a custom description or field in the DevHub,
then querying `ScratchOrgInfo` via SOQL through the DevHub connection.

### Online References

- CLI plugin development: https://github.com/salesforcecli/cli/wiki
- Common coding patterns: https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/common-coding-patterns.html
- @salesforce/core API: https://forcedotcom.github.io/sfdx-core/
- Scratch org concepts: https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_scratch_orgs.htm
- Reference plugin (scratch org create/list/delete): https://github.com/salesforcecli/plugin-org

## Commit & PR Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/). Enforced by `commitlint` (see `commitlint.config.cjs`).

**Scope**: Command name or component (e.g., `pool:prepare`, `poolManager`)
