# summary

Prepare scratch orgs in a pool up to the desired count.

# description

Reads a pool configuration file and creates scratch orgs to fill each defined pool to its desired count. If a pool already has enough orgs, it is skipped. Packages listed as dependencies in sfdx-project.json are installed after each org is created.

Prepares up to 3 orgs concurrently by default. Set concurrency per pool in the config or override all pools with --concurrency. Pools are processed in order and packages are installed sequentially within each org.

# examples

- Prepare all pools defined in the default config file.

  <%= config.bin %> <%= command.id %> --config-file config/pool.json

- Prepare pools and keep failed orgs for inspection instead of deleting them.

  <%= config.bin %> <%= command.id %> --config-file config/pool.json --keep-failed

- Prepare pools using a specific sfdx-project.json file.

  <%= config.bin %> <%= command.id %> --config-file config/pool.json --sfdx-project-file /path/to/sfdx-project.json

- Pipe package installation keys from a secret store into the command.

  vault read -field=pool-keys secret/sf | <%= config.bin %> <%= command.id %> --config-file config/pool.json --package-keys-stdin

- Override configured concurrency and prepare one org at a time.

  <%= config.bin %> <%= command.id %> --config-file config/pool.json --concurrency 1

# flags.concurrency.summary

Maximum concurrent org preparations. Overrides each pool's concurrency setting (default: 3). Use 1 for sequential preparation.

# error.invalid-concurrency

Invalid concurrency for pool '%s': expected a positive safe integer.

# error.invalid-retry-count

Invalid retryCount for pool '%s': expected a nonnegative safe integer.

# info.org-created

[%s][slot %s] Scratch org created: %s

# info.package-installing

[%s][slot %s] Installing package '%s' (%s)...

# info.package-installed

[%s][slot %s] Package '%s' installed.

# info.attempt-failed

[%s][slot %s] Attempt %s failed: %s

# flags.config-file.summary

Path to the pool configuration JSON file.

# flags.sfdx-project-file.summary

Path to sfdx-project.json. Falls back to the path set in the pool config, then sfdx-project.json in the current directory.

# flags.package-keys-stdin.summary

Pipe the package installation keys JSON through standard input (stdin). The JSON format is {"PackageAlias":"installationKey", ...}. Cannot be combined with --package-keys-file.

# flags.package-keys-file.summary

Path to a JSON file containing package installation keys in the format {"PackageAlias":"installationKey", ...}.

# flags.keep-failed.summary

Keep failed orgs instead of deleting them. Failed orgs are tagged with status 'Failed'.

# info.spinner-start

Preparing Scratch Org Pool...

# info.preparing-pools

Preparing scratch org pools: %s

# info.header

Pool Prepare Results

# info.pool-skipped

Pool '%s' is already at capacity (%s/%s orgs). Skipping.

# info.pool-summary

Pool '%s': created %s, failed %s (requested %s, existed %s)

# info.complete

Pool preparation complete.

# info.pool-error

- %s
