# Agents

This repository supports agent-assisted development for a Salesforce CLI plugin.

## Scope

- Implement and maintain `sf pool` commands: `prepare`, `fetch`, `list`, `clean`
- Keep dependencies minimal (prefer stdlib and Salesforce libraries)
- Follow existing command and test patterns in this repository

## Required conventions

- Use `SfCommand` from `@salesforce/sf-plugins-core`
- Use `SfError` from `@salesforce/core` for user-facing errors
- Use kebab-case CLI flags and camelCase in code
- Add logging at key lifecycle points
- Prefer focused, minimal changes over broad refactors

## Build and test

- Install: `pnpm install`
- Build: `pnpm run build`
- Lint: `pnpm run lint`
- Unit tests: `pnpm run test:only`
- Full tests: `pnpm test`

## Project structure

- Source: `src/`
- Shared logic: `src/lib/`
- Commands: `src/commands/`
- Tests: `test/`
- Messages: `messages/`

## Notes for agents

- Keep command output compatible with `--json`
- Do not add new dependencies unless necessary
- Do not commit directly unless explicitly asked
