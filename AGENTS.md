# Agents

This repository supports agent-assisted development for a Salesforce CLI plugin.

## Scope

- Implement and maintain `sf pool` commands: `prepare`, `fetch`, `list`, `clean`
- Keep dependencies minimal (prefer stdlib and Salesforce libraries)
- Follow existing command and test patterns in this repository
- Prefer focused, minimal changes over broad refactors

For coding conventions (flags, errors, logging, testing), see the scoped instructions in `.github/instructions/`.
For architecture and workflows, see `.github/copilot-instructions.md`.

## Build and test

- Install: `pnpm install`
- Build: `pnpm run build`
- Lint: `pnpm run lint`
- Unit tests: `pnpm run test:only`
- Full tests: `pnpm test`

## Pre-submit checklist

Run these before pushing any changes:

1. `pnpm run lint` — no errors
2. `pnpm run test:only` — all unit tests pass
3. `pnpm run build` — compiles cleanly

NUTs (`pnpm run test:nuts`) require DevHub authentication and run in CI only.

## Project structure

- Source: `src/`
- Shared logic: `src/lib/`
- Commands: `src/commands/`
- Tests: `test/`
- Messages: `messages/`

## CI checks

### `tests` (branches + PRs, excluding main)

Triggered on pushes to non-main branches and on pull requests when `src/`, `test/`, `tsconfig.json`, `package.json`, or `pnpm-lock.yaml` change.

1. **Unit Tests and Linting** — `pnpm test` (compile + lint + unit tests)
2. **NUTs** (after unit tests pass) — `pnpm run build` then `pnpm run test:nuts` on Ubuntu and Windows

### `build` (main only)

Triggered on pushes to `main` when `src/`, `bin/`, `package.json`, `pnpm-lock.yaml`, or `tsconfig.json` change.

1. `pnpm test`
2. `pnpm run build`
3. `pnpm pack` (uploads tarball as artifact)

### `zizmor` (main + PRs)

Triggered when `.github/**/*.yml` files change. Runs [zizmor](https://github.com/woodruffw/zizmor) security analysis on GitHub Actions workflows and uploads SARIF results.

### `Automerge Dependabot` (scheduled weekdays 10:00 UTC)

Automatically merges Dependabot PRs via squash merge. Blackout periods: weekends, July, Dec 20–Jan 5.

### `Copilot Setup Steps`

Environment setup for GitHub Copilot coding agent: install, compile, lint, and unit tests.

## Notes for agents

- Keep command output compatible with `--json`
- Do not add new dependencies unless necessary
- Do not commit directly unless explicitly asked
