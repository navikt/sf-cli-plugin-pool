# suggestion.no-devhub

No default DevHub is configured. Set one with:

sf config set target-dev-hub <username-or-alias>

Pool custom fields cannot be verified without a reachable DevHub.

# suggestion.field-missing

One or more ScratchOrgInfo custom fields required by this plugin are missing or inaccessible in your DevHub. Ensure the following fields exist on the ScratchOrgInfo object:

- Pool_tag\_\_c (Text)
- Pool_allocation_status\_\_c (Picklist)
- Sfdx_Auth_Url\_\_c (Text)
- Pool_claim_token\_\_c (Text)

See the plugin README (DevHub Requirements section) for full field specifications.
