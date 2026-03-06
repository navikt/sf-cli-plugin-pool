---
mode: 'agent'
description: 'Write unit tests for a pool command'
---

Write unit tests for the `pool:{{command}}` command.

## Requirements

- Create or update `test/commands/pool/{{command}}.test.ts`
- Use `TestContext` from `@salesforce/core/testSetup` for sandboxing
- Use `stubSfCommandUx` from `@salesforce/sf-plugins-core` to capture output
- Invoke the command via `CommandClass.run([...args])`
- Cover: happy path, flag validation, error cases (bad config, missing org), and edge cases (empty pool, zero count)
- Assert both the returned result object and user-facing log output
- Run `pnpm run test:only` to verify all tests pass and coverage thresholds are met

## Context

Follow the patterns in `.github/instructions/tests.instructions.md` and `.github/skills/pool-test.md`.
Use `test/commands/hello/world.test.ts` as a reference implementation.
