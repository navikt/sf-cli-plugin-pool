---
applyTo: 'messages/**/*.md'
---

# Message File Format

Message files provide all user-facing strings for a command. They are Markdown files where each `# heading` defines a message key.

## File naming

`messages/<topic>.<command>.md` — e.g., `messages/pool.list.md`

## Required keys

Every command message file should include at minimum:

```markdown
# summary

One-line summary shown in help output.

# description

Longer description of what the command does.

# examples

- Short description of example:

  <%= config.bin %> <%= command.id %> --flag value

# flags.<flag-name>.summary

Description of the flag.
```

## Conventions

- `# summary` and `# description` are required for every command
- `# examples` uses `<%= config.bin %>` and `<%= command.id %>` EJS templates
- `# flags.<name>.summary` for each flag (use kebab-case flag name)
- `# info.*` / `# error.*` for runtime messages
- Use `%s` placeholders for runtime values (positional substitution)
- Keep messages concise and actionable

## Reference implementation

See `messages/pool.list.md` for a working example.
