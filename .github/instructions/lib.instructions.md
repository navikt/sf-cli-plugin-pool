---
applyTo: 'src/lib/**/*.ts'
---

# Library Code

Files under `src/lib/` contain shared business logic used by multiple commands.

## When to Extract to lib/

- Logic is used (or will be used) by more than one command
- The function doesn't depend on `SfCommand` instance methods (`this.log`, `this.parse`)
- Complex domain operations: pool state management, org lifecycle, config validation

Keep command files thin — they parse flags, call lib functions, and format output.

## Conventions

- Use `@salesforce/core/Logger` for logging (not `this.log()` which is command-only)
  ```typescript
  import { Logger } from '@salesforce/core';
  const logger = Logger.childFromRoot('poolManager');
  logger.debug('Looking up pool', { tag, count });
  ```
- Throw `SfError` from `@salesforce/core` for all error conditions
- Export functions and classes explicitly — no default exports
- Accept dependencies as parameters (org connections, config) rather than creating them internally — this makes unit testing straightforward
- Keep files focused: one module per domain concept (e.g., `poolManager.ts`, `orgLifecycle.ts`, `configValidator.ts`)

## Reference implementation

See `src/commands/hello/world.ts` for the command side of the pattern. Library code should contain the logic that commands delegate to.
