---
applyTo: 'test/**/*.nut.ts'
---

# NUT (Non-Unit Test) Pattern

NUTs are integration tests that run real CLI commands against a DevHub. They require authentication and run in CI only.

## Structure

```typescript
import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { ResultType } from '../../../src/commands/pool/mycommand.js';

let testSession: TestSession;

describe('pool mycommand NUTs', () => {
  before('prepare session', async () => {
    testSession = await TestSession.create();
  });

  after(async () => {
    await testSession?.clean();
  });

  it('should return expected result', () => {
    const result = execCmd<ResultType>('pool mycommand --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result).to.have.property('expectedKey');
  });
});
```

## Conventions

- Use `TestSession.create()` in `before` and `testSession.clean()` in `after`
- Run commands with `execCmd<ResultType>('command --json', { ensureExitCode: 0 })`
- Assert on `jsonOutput.result` for structured validation
- NUTs require DevHub auth — never run locally without setup
- File naming: `<command>.nut.ts` alongside the unit test file

## Running

- `pnpm run test:nuts` — requires DevHub authentication and the test packages set up
- NUTs run in CI on Ubuntu and Windows after unit tests pass

## Test Package Prerequisite

Before running NUTs locally, the three test packages (`pool-test-a`, `pool-test-b`, `pool-test-c`) must exist in the target DevHub and the root `sfdx-project.json` must be generated.

Local setup (run once per DevHub):

```bash
pnpm run setup:test-packages -- --target-dev-hub <alias>
```

In CI this happens automatically before NUTs (see `.github/workflows/test.yml`).

If NUTs fail with `PackageVersionNotFoundError` or `SfdxProjectNotFoundError`, the setup script either failed or has not been run.

Full contributor walkthrough: see "Local Test Environment Setup" in `README.md`.

## Reference implementation

See `test/commands/pool/list.nut.ts` for a working example.
