---
agent: 'agent'
description: 'Scaffold a new pool subcommand with command, messages, and tests'
---

Create a new `sf pool` subcommand called `pool:{{name}}`.

## Requirements

- Scaffold using: `sf dev generate command --name pool:{{name}} --force`
- Verify `package.json` → `oclif.topics` includes the `pool` topic
- Implement the command logic in `src/commands/pool/{{name}}.ts`
- Fill in `messages/pool.{{name}}.md` with real summaries, descriptions, and examples
- Write unit tests in `test/commands/pool/{{name}}.test.ts`
- Run `pnpm run compile` and `pnpm run test:only` to verify

## Context

Follow the patterns in `.github/instructions/commands.instructions.md` and `.github/skills/pool-command.md`.
Use `src/commands/pool/list.ts` as a reference implementation.
