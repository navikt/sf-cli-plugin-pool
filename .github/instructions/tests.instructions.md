---
applyTo: 'test/**/*.test.ts'
---

# Unit Test Pattern

Unit tests use Mocha `describe`/`it` with Chai `expect` assertions.

## Sandbox Setup

Every test file must use `TestContext` for sandboxing and `stubSfCommandUx` to capture command output:

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
});
```

## Running Commands

Invoke commands directly via `CommandClass.run([...args])`:

```typescript
const result = await MyCommand.run(['--target-dev-hub', 'test@hub.org']);
```

## What to Assert

- **Returned result**: verify typed properties on the JSON-compatible result
- **User output**: check `sfCommandStubs.log.getCalls().flatMap((c) => c.args).join('\n')` for expected messages
- **Error cases**: wrap in try/catch and assert `SfError` with expected name/message

## Coverage Requirements

- Happy path — command returns correct data
- Flag validation — required flags reject missing input
- Error cases — bad config, missing org, expired credentials
- Edge cases — empty pools, zero count

## Running

- `pnpm run test:only` — unit tests with coverage
- Coverage thresholds: 75% lines/statements/functions/branches (enforced by nyc)

## Reference implementation

See `test/commands/pool/list.test.ts` for a working example.

## Boundaries

### ✅ Always

- Write tests for new code before committing
- Test both success and error cases
- Use descriptive test names
- Clean up test data after each test
- Run full test suite before pushing

### ⚠️ Ask First

- Changing test framework or structure
- Adding complex test fixtures
- Modifying shared test utilities
- Disabling or skipping tests

### 🚫 Never

- Commit failing tests
- Skip tests without good reason
- Test implementation details
- Share mutable state between tests
- Commit without running tests
