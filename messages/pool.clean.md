# summary

Delete scratch orgs from a pool.

# description

Deletes scratch orgs from one or more pools. By default only orgs with status 'failed' are targeted. Use --status to target specific statuses, or --all to target every status. When 'In Use' orgs are included, the command prompts for confirmation unless --no-prompt is set.

# examples

- Clean failed scratch orgs from all pools.

  <%= config.bin %> <%= command.id %>

- Clean failed scratch orgs from a specific pool.

  <%= config.bin %> <%= command.id %> --pool-tag myPool

- Clean scratch orgs with specific statuses.

  <%= config.bin %> <%= command.id %> --status failed --status Available

- Clean all scratch orgs from a pool without confirmation.

  <%= config.bin %> <%= command.id %> --pool-tag myPool --all --no-prompt

# flags.pool-tag.summary

Tag of the pool to clean. Repeat to target multiple pools.

# flags.status.summary

Allocation status of orgs to delete. Repeat to target multiple statuses. Default: failed.

# flags.all.summary

Target all allocation statuses. Prompts for confirmation when 'In Use' orgs are present.

# flags.no-prompt.summary

Skip confirmation prompt when deleting 'In Use' orgs.

# info.spinner-start

Querying pool orgs...

# info.spinner-done

Done

# info.no-orgs

No scratch orgs found matching the specified criteria.

# info.found-orgs

Found %s scratch org(s) to delete.

# info.deleting-org

Deleting scratch org %s (pool: %s, status: %s)...

# info.deleted-org

Deleted scratch org %s.

# info.failed-org

Failed to delete scratch org %s: %s

# info.summary-header

Pool Clean Results

# info.summary

Deleted: %s, Failed: %s, Total: %s

# prompt.confirm-in-use

This will delete %s 'In Use' scratch org(s). Continue?

# error.prompt-declined

Aborted: user declined to delete 'In Use' orgs.
