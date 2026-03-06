---
applyTo: 'src/types/**/*.ts'
---

# Type Definitions

Files under `src/types/` contain shared TypeScript type definitions used across the plugin.

## Conventions

- Use `type` (not `interface`) for data shapes — keeps consistency and supports unions/intersections
- Always export types explicitly — no default exports
- No runtime logic in type files — pure type declarations only
- One file per domain concept (e.g., `pool-config.ts`, `pool-state.ts`)
- Optional fields use `?` suffix — document what happens when omitted

## Reference implementation

See `src/types/pool-config.ts` for the current pattern. See `config/pool-example.json` for a matching runtime example.
