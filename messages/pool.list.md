# summary

List the number of orgs in a pool.

# description

View the number of scratch orgs in a pool. Add the pool tag to select the pool to get numbers for.

# examples

- List the number of orgs in all pools.

  <%= config.bin %> <%= command.id %>

- List the number of orgs in a specific pool.

  <%= config.bin %> <%= command.id %> --pool-tag myTag

# flags.pool-tag.summary

Tag of the pool to list. Repeat to view for more pools.

# info.spinner-start

Listing Scratch Org Pools...

# info.header

Scratch Pool Details

# info.totals-header

Scratch Org Pool Totals:

# info.unused-count

Unused Scratch Orgs in the Pool : %s

# info.total-count

Total Scratch Orgs in the Pool : %s

# error.query-failed

Failed to query scratch org pool information from DevHub. %s
