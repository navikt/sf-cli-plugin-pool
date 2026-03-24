---
name: pool-test
description: Write unit tests for pool commands following project patterns.
---

# Pool Test Skill

Use this skill when writing unit tests for a `pool:*` command.

## Steps

1. **Create the test file** at `test/commands/pool/<name>.test.ts`
2. **Follow the sandbox pattern** — use `TestContext` and `stubSfCommandUx`
3. **Run tests** — `pnpm run test:only`
4. **Check coverage** — review nyc output for uncovered branches

## Test Template

```typescript
import { TestContext } from '@salesforce/core/testSetup';
import { expect } from 'chai';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import <Name> from '../../../../src/commands/pool/<name>.js';

describe('pool <name>', () => {
  const $$ = new TestContext();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;

  beforeEach(() => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
  });

  afterEach(() => {
    $$.restore();
  });

  it('returns expected result', async () => {
    // arrange: stub org connections, config reads, etc.

    // act
    const result = await <Name>.run(['--target-dev-hub', 'test@hub.org']);

    // assert
    expect(result).to.exist;
  });

  it('handles missing config gracefully', async () => {
    try {
      await <Name>.run(['--target-dev-hub', 'test@hub.org']);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.have.property('name', 'SfError');
    }
  });
});
```

## What to Test

- **Happy path** — command returns typed result with correct data
- **Flag validation** — required flags reject missing input
- **Error cases** — bad config, missing org, expired credentials → SfError
- **Output** — verify `sfCommandStubs.log` contains expected messages
- **Edge cases** — empty pools, zero count, concurrent access

## Acceptance Criteria

- [ ] Tests use `TestContext` sandbox (no real org calls)
- [ ] Tests invoke command via `CommandClass.run([...args])`
- [ ] Both returned result and user output are asserted
- [ ] At least one error/edge case is covered
- [ ] `pnpm run test:only` passes
