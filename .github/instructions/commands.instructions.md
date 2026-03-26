---
applyTo: 'src/commands/**/*.ts'
---

# Command Implementation

Every command extends `SfCommand<ResultType>` from `@salesforce/sf-plugins-core`.

## Structure

```typescript
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('pool', 'pool.<name>');

export type PoolResultType = {
  /* typed result */
};

export default class Name extends SfCommand<PoolResultType> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'flag-name': Flags.string({
      char: 'f',
      summary: messages.getMessage('flags.flag-name.summary'),
    }),
  };

  public async run(): Promise<PoolResultType> {
    const { flags } = await this.parse(Name);
    // implementation
    return {
      /* result */
    };
  }
}
```

## Conventions

- Flag names: kebab-case in CLI (`--pool-name`), camelCase in code (`flags.poolName`)
- All user-facing strings must come from the message file — never hardcode
- Errors: throw `new SfError(messages.getMessage('error.key'))` with descriptive messages
- Return typed result objects compatible with `--json` output
- Use `@salesforce/core` Config class for persisting pool definitions and state

## Logging

- `this.log()` for user output
- `this.logToFile()` for debug logs consumed by the doctor system
- Log at: command start, pool lookups, org creation attempts, success/failure states
- Include structured context (pool name, org count, error details)

## Reference implementation

See `src/commands/pool/list.ts` for a working example of the command pattern.
