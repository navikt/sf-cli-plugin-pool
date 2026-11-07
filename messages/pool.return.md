# summary

Return a fetched scratch org to its pool.

# description

Returns a scratch org that you fetched with "pool fetch" to its pool so that it can be fetched again. The org must be active, belong to a pool, have the allocation status "assigned", and its ScratchOrgInfo and ActiveScratchOrg records in the Dev Hub must be owned by you.

The command restores ownership of both records to the users who created them, restores the stored auth URL, clears the claim token, and marks the org as available in a single Dev Hub transaction. The original fetch claim saved in local authentication must still match the Dev Hub claim. After the transaction succeeds, the org's local authentication, aliases, and default-org settings are removed.

The org is reused as-is: its data and metadata aren't reset, and copies of its credentials stored elsewhere aren't revoked.

# examples

- Return the scratch org with the alias myScratch to its pool:

  <%= config.bin %> <%= command.id %> --target-org myScratch --target-dev-hub myDevHub

- Return your default scratch org to the pool of your default Dev Hub and output JSON:

  <%= config.bin %> <%= command.id %> --json

# info.spinner-start

Returning scratch org to pool...

# info.spinner-done

Done

# info.spinner-failed

Failed

# info.progress-verify

Verifying scratch org %s in the Dev Hub...

# info.progress-update

Returning scratch org %s to pool '%s'...

# info.progress-cleanup

Removing local authentication for %s...

# info.returned

Returned scratch org %s to pool '%s'.

# info.local-auth-removed

Removed local authentication, aliases, and default-org settings for %s.

# warning.local-auth-not-removed

Returned %s to the pool, but couldn't remove its local authentication: %s. Run "sf org logout --target-org %s --no-prompt" to remove it.

# warning.local-auth-preserved

Returned %s to the pool, but its local authentication no longer matches the returned claim and was left untouched. Check the credentials for %s before using or removing them.

# error.user-id

Couldn't determine the authenticated Dev Hub user. %s

# error.query

Failed to look up scratch org %s in the Dev Hub. %s

# error.invalid-org-id

The local authentication has an invalid org ID: %s.

# error.not-found

Scratch org %s (%s) wasn't found in Dev Hub %s. Specify the Dev Hub that the org was fetched from.

# error.missing-parent

Couldn't read the ScratchOrgInfo record of scratch org %s in the Dev Hub.

# error.multiple-records

Found more than one active scratch org record for %s (%s) in the Dev Hub, so it wasn't returned.

# error.not-active

Scratch org %s can't be returned because its status is '%s'. Only active orgs can be returned.

# error.not-pool-org

Scratch org %s doesn't belong to a pool.

# error.not-assigned

Scratch org %s can't be returned because its allocation status is '%s'. Only assigned orgs can be returned.

# error.not-owner

You don't own the %s record of scratch org %s. Only the user who fetched the org can return it.

# error.missing-creator

Couldn't determine who created the %s record of scratch org %s.

# error.username-mismatch

The local authentication for %s doesn't match the scratch org's signup username %s. Authenticate as the signup user and try again.

# error.auth-url

Couldn't get a reusable auth URL for %s. The org must be authenticated with a refresh token, for example by "pool fetch".

# error.missing-claim-token

Scratch org %s has no claim token in the Dev Hub, so it can't be verified as fetched with "sf pool fetch" and wasn't returned.

# error.missing-local-claim-token

Local authentication for scratch org %s doesn't contain its original pool claim, so it can't be safely returned.

# error.stale

The original fetch claim for scratch org %s no longer matches its claim in the Dev Hub, so it wasn't returned and no changes were saved. Run "sf pool list" to check the org's status.

# error.update

Failed to return scratch org %s to the pool. No changes were saved in the Dev Hub. %s

# error.unexpected-response

The Dev Hub returned an unexpected response.

# error.uncertain

Couldn't confirm whether scratch org %s was returned to the pool. Local authentication was kept. Run "sf pool list" to check the org's status: if it's still assigned, run this command again; if it's available, run "sf org logout --target-org %s --no-prompt". %s
