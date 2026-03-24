---
name: pool-flag
description: Add flags to existing pool commands using the sf CLI generator.
---

# Pool Flag Skill

Use this skill when adding new flags to an existing `pool:*` command.

## Steps

1. **Generate the flag** — run the interactive sf CLI generator:

   ```bash
   sf dev generate flag
   ```

   The generator will:

   - List all commands in the plugin and ask which one to modify
   - Prompt for: long name (kebab-case), optional short name, type, required/optional, description
   - Update the command's TypeScript file with the new flag code
   - Prevent duplicate long or short flag names

2. **Preview first (optional)** — use `--dry-run` to review the generated code before applying:

   ```bash
   sf dev generate flag --dry-run
   ```

3. **Update the message file** — add the flag summary to `messages/pool.<name>.md`:

   ```markdown
   # flags.<flag-name>.summary

   Description of what the flag does.
   ```

4. **Update tests** — add test cases that exercise the new flag in `test/commands/pool/<name>.test.ts`

5. **Build and verify** — run `pnpm run compile` and `./bin/dev.js pool <name> --help`

## Flag Naming Conventions

- Long names: **kebab-case** (e.g. `--pool-name`, `--expiration-days`)
- Short names: single letter, avoid collisions with existing flags
- In code: use **camelCase** (e.g. `flags.poolName`, `flags.expirationDays`)

## Common Pool Flag Types

| Flag                      | Type                | Example                           |
| ------------------------- | ------------------- | --------------------------------- |
| `--pool-name` / `-p`      | `Flags.string`      | `--pool-name my-pool`             |
| `--target-dev-hub` / `-v` | `Flags.requiredHub` | `--target-dev-hub myHub`          |
| `--count` / `-c`          | `Flags.integer`     | `--count 10`                      |
| `--expiration-days`       | `Flags.integer`     | `--expiration-days 7`             |
| `--config-file` / `-f`    | `Flags.file`        | `--config-file config/pools.json` |
| `--no-prompt`             | `Flags.boolean`     | `--no-prompt`                     |

## Acceptance Criteria

- [ ] Flag long name is kebab-case
- [ ] Flag summary string is in the message file (not hardcoded)
- [ ] Required flags have validation and clear error messages
- [ ] Tests cover the flag (present, absent, invalid value)
- [ ] `./bin/dev.js pool <name> --help` shows the new flag
