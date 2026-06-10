# summary

Fetch a scratch org from a pool.

# description

Fetches the oldest available scratch org from a pool, marks it as assigned, and authenticates you to it. Use --alias to set an alias and --set-default to make it the default org.

# examples

- Fetch a scratch org from a pool:

  <%= config.bin %> <%= command.id %> --pool-tag myPool

- Fetch and set as default org with an alias:

  <%= config.bin %> <%= command.id %> --pool-tag myPool --set-default --alias myScratch

# flags.pool-tag.summary

Tag of the pool to fetch from.

# flags.set-default.summary

Set the fetched scratch org as the default org.

# flags.alias.summary

Alias to set for the fetched scratch org.

# info.spinner-start

Fetching scratch org from pool...

# info.spinner-done

Done

# info.fetched

Fetched scratch org %s from pool '%s'.

# info.set-default

Set %s as default org.

# info.set-alias

Alias '%s' set for %s.

# info.instance-url

Instance URL: %s

# error.no-available

No available scratch orgs found in pool '%s'.

# error.fetch-failed

Failed to fetch scratch org from pool. %s
