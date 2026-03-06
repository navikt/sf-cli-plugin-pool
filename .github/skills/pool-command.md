---
name: pool-command
description: Scaffold a new sf pool subcommand following project patterns.
---

# Pool Command Skill

Use this skill when creating a new `pool:*` subcommand (e.g. `pool:list`, `pool:fetch`, `pool:prepare`, `pool:clean`).

## Steps

1. **Scaffold** — run the sf CLI generator to create command, message, and test files:
   ```bash
   sf dev generate command --name pool:<name> --force
   ```
   This creates:
   - `src/commands/pool/<name>.ts` (command)
   - `messages/pool.<name>.md` (user-facing strings)
   - `test/commands/pool/<name>.test.ts` (unit test stub)
   - `test/commands/pool/<name>.nut.ts` (NUT stub)
2. **Register the topic** — ensure `package.json` → `oclif.topics` includes `pool`
3. **Implement** — fill in the generated command with pool-specific logic
4. **Build and verify** — run `pnpm run compile` and `./bin/dev.js pool <name> --help`

## Post-Scaffold Checklist

After scaffolding, update the generated files:

- **Command file**: Add pool-specific flags (e.g. `target-dev-hub`, `pool-name`), typed result, business logic
- **Message file**: Replace placeholder strings with real summaries, descriptions, and examples
- **Test file**: Add sandbox stubs (`TestContext`, `stubSfCommandUx`) and meaningful assertions
- Use kebab-case for flag names, camelCase in code
- Use `SfError` from `@salesforce/core` for error handling
- Add logging at key lifecycle points (`this.log()` / `this.debug()`)

## Shared Logic (`src/lib/`)

If the command requires non-trivial business logic (org creation, pool state queries, config validation), extract it to `src/lib/`:

- Keep the command file thin: parse flags → call lib → format output
- Library code uses `@salesforce/core/Logger`, not `this.log()`
- Accept dependencies as parameters for testability
- See `.github/instructions/lib.instructions.md` for full conventions

## Test Fixtures

Use `config/pool-example.json` as a reference pool configuration for tests and validation.

## Acceptance Criteria

- [ ] Command extends `SfCommand`
- [ ] Errors use `SfError` from `@salesforce/core`
- [ ] All user-facing strings are in the message file
- [ ] `--json` output returns the typed result object
- [ ] Flags use kebab-case
- [ ] Key lifecycle points have logging (`this.log()` / `this.debug()`)
- [ ] Non-trivial logic extracted to `src/lib/`
