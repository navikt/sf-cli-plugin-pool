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

1. Use `TestSession.create()` in `before` and `testSession.clean()` in `after`
2. Run commands with `execCmd<ResultType>('command --json', { ensureExitCode: 0 })`
3. Assert on `jsonOutput.result` for structured validation
4. NUTs require DevHub authentication and setup. Do not run locally unless the setup script has been executed successfully.
5. File naming: `<command>.nut.ts` alongside the unit test file

## Running

1. Run `pnpm run test:nuts` only after DevHub authentication and test package setup.
2. In CI, NUTs run on Ubuntu after core tests pass.

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
