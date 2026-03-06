# summary

List the number of orgs in a pool.

# description

View the number of scratch orgs in a pool. Add the pool tag to select the pool to get numbers for.

# examples

- List the number of orgs in all pools.

  <%= config.bin %> <%= command.id %>

- List the number of orgs in spesific pool.

  <%= config.bin %> <%= command.id %> --pool-tag

# flags.pool-tag.summary

Tag of the pool to list. Repeat to view for more pools.
