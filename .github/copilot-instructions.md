# AI Coding Instructions for sf-cli-plugin-pool

## Project Overview

This is a Salesforce CLI plugin for managing scratch org pools using a bare-bones, minimal-dependency approach. Dependencies to Salesforce related libraries are OK. It extends the `@salesforce/cli` ecosystem with commands to create, fetch, list, and delete scratch organizations organized into pools (defined via JSON config files).

### Core Commands

- `sf pool prepare` - Create and tag new scratch orgs to replenish pools (used by CI)
- `sf pool fetch` - Allocate an available scratch org from a pool (used by CI validation runs and developers)
- `sf pool list` - Display pool status: available/total/in-use counts (used by developers and platform team)
- `sf pool clean` - Remove failed, stale, or expired orgs from pools (used by CI jobs and platform team)

All commands integrate with the `sf doctor` system and include substantial logging.

## Key Architecture Decisions

### Salesforce CLI Plugin Structure

- Based on `@salesforce/cli-plugins-core` framework
- Commands organized in `src/commands/pool/` directory (command hierarchy: `pool:prepare`, `pool:fetch`, `pool:list`, `pool:clean`)
- Each command extends `SfCommand` class
- Minimal external dependencies - use only `@salesforce/core` and `@salesforce/cli-plugins-core`

### Pool Configuration Format

Pools are defined via JSON config files with structure like:

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

### Plugin Conventions to Follow

- **Command naming**: `pool:prepare`, `pool:fetch`, `pool:list`, `pool:clean` (strict hierarchy)
- **Flags/Parameters**: Use camelCase in code, kebab-case in CLI (e.g., `--pool-name`)
- **Error handling**: Use `SfError` from `@salesforce/core` with meaningful messages
- **Logging**: Extensive logging throughout (debug, info, warn levels) - not just error cases
- **Doctor Integration**: Commands must register health checks with SF doctor system
- **Configuration**: Use `@salesforce/core` Config class for persisting pool definitions and state

## Salesforce Documentation References

- [Plugin Development Guide](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide)
- [Command Implementation](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/command-implementation)
- [Messages & Localization](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/messages)
- [Testing Plugins](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/testing)
- [Doctor System Integration](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/doctor)
- [Use Libraries](https://developer.salesforce.com/docs/platform/salesforce-cli-plugin/guide/use-libraries.html)

## Salesforce Library References

### Core Libraries for This Plugin

- **@salesforce/core**

  - [Repository](https://github.com/forcedotcom/sfdx-core)
  - [API Docs](https://forcedotcom.github.io/sfdx-core/)
  - Key classes: `AuthInfo`, `Org`, `Connection`, `ConfigFile`, `SfError`, `Messages`, `Logger`

- **@salesforce/sf-plugins-core**
  - [Repository](https://github.com/salesforcecli/sf-plugins-core)
  - [API Docs](https://salesforcecli.github.io/sf-plugins-core/)
  - Key class: `SfCommand` (base class for all commands)

### Recommended Supporting Libraries

- **@salesforce/kit**

  - [Repository](https://github.com/forcedotcom/kit)
  - [API Docs](https://forcedotcom.github.io/kit/)
  - JSON utilities, environment variables, design patterns

- **@salesforce/ts-types**

  - [Repository](https://github.com/forcedotcom/ts-types)
  - [API Docs](https://forcedotcom.github.io/ts-types/)
  - Type guards and utility types for TypeScript

- **@salesforce/source-deploy-retrieve**
  - [Repository](https://github.com/forcedotcom/source-deploy-retrieve)
  - [API Docs](https://forcedotcom.github.io/source-deploy-retrieve/)
  - Functionality for working with Salesforce metadata

### Testing Libraries

- **@salesforce/cli-plugins-testkit**
  - [Repository](https://github.com/salesforcecli/cli-plugins-testkit)
  - [Samples](https://github.com/salesforcecli/cli-plugins-testkit/blob/main/SAMPLES.md)
  - For NUTs (non-unit-tests), integration, and e2e tests

### Underlying Framework

- **@oclif/core**
  - [Repository](https://github.com/oclif/core)
  - [Docs](https://oclif.io/)
  - Powers the entire Salesforce CLI (usually abstracted away by `@salesforce/sf-plugins-core`)

## Development Workflow

### Setup

```bash
pnpm install
pnpm run build  # TypeScript compilation
```

### Testing

```bash
pnpm test             # Run unit tests (Mocha + Chai + nyc)
pnpm run test:only    # Run tests without lint/compile checks
pnpm run test:nuts    # Run NUTs (non-unit-tests / integration tests)
```

### Linting & Format

```bash
pnpm run lint
pnpm run format
```

### Building/Publishing

```bash
pnpm run build    # Compile + lint via wireit
pnpm run prepack  # Build + generate oclif manifest + shrinkwrap
```

## Project-Specific Patterns

### Expected File Structure

```
src/
├── commands/          # CLI command implementations
├── lib/               # Shared business logic
├── messages/          # User-facing strings (JSON files)
└── types/             # TypeScript interfaces

test/                  # Unit tests matching src/ structure
```

### Dependencies to Expect

- `@salesforce/core`: Utilities (Config, Auth, Logger, SfError, Org)
- `@salesforce/sf-plugins-core`: Plugin helper utilities (SfCommand base class)
- `@oclif/core`: Underlying CLI framework (usually abstracted by sf-plugins-core)
- Testing: Mocha + Chai + nyc for coverage, `@salesforce/core/testSetup` for `TestContext` and sandbox utilities, `@salesforce/sf-plugins-core` for `stubSfCommandUx`
- **Bare-bones approach**: Avoid adding dependencies unless absolutely necessary; leverage stdlib and Salesforce-provided utilities

### Logging Strategy

- Use `this.log()` in commands for user output
- Use `this.logToFile()` for detailed debug logs (often expected by doctor system)
- Leverage `@salesforce/core/Logger` class in library code for fine-grained control (debug, info, warn)
- Log at key lifecycle points: command start, pool lookups, org creation attempts, success/failure states
- Include structured context in logs (pool name, org count, error details) for troubleshooting

## Critical Workflows

**Common command workflow**:

1. Parse flags/args (e.g., config file path, pool name, target org)
2. Validate inputs (error via `SfError` for invalid configs or missing orgs)
3. Load pool configuration from JSON file
4. Perform org operations (create/fetch/delete using DevHub context)
5. Log activity and return structured results (compatible with `--json` output)

**Pool management lifecycle**:

1. **Prepare**: Parse JSON config → validate pool specs → create orgs in DevHub → tag with pool name → persist pool state to Config
2. **Fetch**: Load pool state → find available org → mark as allocated → return org credentials to CI or developer
3. **List**: Load pool state → aggregate counts by pool → display available/total/in-use status
4. **Clean**: Load pool state → delete failed/stale/expired orgs from DevHub → update pool state

**Doctor integration**:
Commands should register health checks that validate:

- DevHub org is accessible
- Pool configuration files are readable and valid JSON
- All tracked orgs still exist in DevHub (cleanup orphaned entries)

**Testing pattern**: Use Mocha `describe`/`it` blocks with Chai `expect` assertions. Use `TestContext` from `@salesforce/core/testSetup` for sandboxing, and `stubSfCommandUx` from `@salesforce/sf-plugins-core` to capture command output. Run commands directly via `CommandClass.run([...args])`. Example:

```typescript
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import MyCommand from '../../../src/commands/pool/mycommand.js';

describe('pool mycommand', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('runs successfully', async () => {
    const result = await MyCommand.run([]);
    expect(result).to.exist;
  });
});
```

## File Examples (To Be Created)

- Look at `src/commands/pool/*.ts` for command patterns
- Look at `src/lib/poolManager.ts` for business logic separation
- Check `.messages.json` files for message patterns

## Commit & PR Conventions

The following conventions help maintain clarity and consistency in the project's version history.

Should be written in Norwegian.

### Commit Message Format

Follow the [Conventional Commits specification](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Allowed Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
**Scope**: Command name or component (e.g., `pool:prepare`, `poolManager`)
**Description**: Lowercase, imperative, no period
**Body**: Optional detailed explanation of the change
**Footer**: Optional metadata (breaking changes, issue references)

**Examples**:

- `feat(pool:prepare): add org creation with retry logic`
- `fix(pool:fetch): handle expired org credentials`
- `test(pool:list): add pool status aggregation tests`
- `chore: bump @salesforce/core to latest`
- `docs: update README with usage examples`
- `refactor(poolManager): extract pool management logic to separate class`
- `perf(pool:prepare): optimize org creation to reduce API calls`
- Multi-line example with body:

  ```
  refactor(poolManager): extract pool management logic to separate class

  Moved org creation and tagging logic from command to PoolManager class
  for better testability and separation of concerns.
  ```

### Pull Request Template

```
## Description
Brief summary of changes

## Type of Change
- [ ] New command
- [ ] Bug fix
- [ ] Feature enhancement
- [ ] Test coverage
- [ ] Documentation

## Testing
How to test locally

## Doctor Integration
Any new doctor health checks added?
```

---

_Last updated: 2026-01-29. Update as project structure emerges._
