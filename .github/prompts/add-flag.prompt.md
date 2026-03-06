---
mode: 'agent'
description: 'Add a new flag to an existing pool command'
---

Add a new flag called `--{{flag-name}}` to the `pool:{{command}}` command.

## Requirements

- Use `sf dev generate flag` or add the flag manually to `src/commands/pool/{{command}}.ts`
- Use kebab-case for the flag name, camelCase in code
- Add the flag summary to `messages/pool.{{command}}.md` under `# flags.{{flag-name}}.summary`
- Add test cases covering the flag (present, absent, invalid value) in `test/commands/pool/{{command}}.test.ts`
- Run `pnpm run compile` and `pnpm run test:only` to verify

## Context

Follow the patterns in `.github/instructions/commands.instructions.md` and `.github/skills/pool-flag.md`.
