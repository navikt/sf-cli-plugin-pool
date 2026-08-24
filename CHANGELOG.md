# Changelog

## 1.0.0 (2026-08-24)


### Features

* add api-version flag to pool list command ([89c5f21](https://github.com/navikt/sf-cli-plugin-pool/commit/89c5f21160a9a199a6e4d2959888fcba47de004f))
* add detect-nuts-relevance job to determine NUT necessity based on changes ([b564eea](https://github.com/navikt/sf-cli-plugin-pool/commit/b564eea0542ebba297f621b9e6f718230b700095))
* add diagnostics hook for checking DevHub configuration and field accessibility ([4665a5a](https://github.com/navikt/sf-cli-plugin-pool/commit/4665a5ac339c7d6b482be60253959f6852831a5e))
* add GitHub Actions workflow for publishing to GitHub Packages ([5b5db6e](https://github.com/navikt/sf-cli-plugin-pool/commit/5b5db6eb9e3f1bda68a5d89c07a3d3cce9bb8574))
* add mise tools update workflow and configuration files ([#115](https://github.com/navikt/sf-cli-plugin-pool/issues/115)) ([73ac5ac](https://github.com/navikt/sf-cli-plugin-pool/commit/73ac5acf068435c023f77e1d1edfd4452e7c7b70))
* add SBOM generation and validation steps to build workflow ([3896841](https://github.com/navikt/sf-cli-plugin-pool/commit/3896841aff81b69f1d6565d97e16995ec90ecd67))
* add test-agent for automated test writing ([69d1ddb](https://github.com/navikt/sf-cli-plugin-pool/commit/69d1ddb4f2bf9e68cd8fdaa437d43ec33fd89892))
* enhance org fetching and claiming logic with contention handling ([d1ec221](https://github.com/navikt/sf-cli-plugin-pool/commit/d1ec221b42a849150a0b5075971ca77fc6a6dddb))
* enhance org fetching logic to skip invalid candidates and claim valid ones in batch ([7d654c1](https://github.com/navikt/sf-cli-plugin-pool/commit/7d654c150a14dfa7bafaa46f7c339810ac77fa98))
* implement ownership transfer for claimed scratch orgs and enhance org fetching logic ([de7f097](https://github.com/navikt/sf-cli-plugin-pool/commit/de7f097b498bc21c878fb6ef53006361586c6878))
* implement pool list command with support for filtering by pool tags and human-readable output ([9dd4d5c](https://github.com/navikt/sf-cli-plugin-pool/commit/9dd4d5c5ce10a48ded04480cd755aa1c07241064))
* implement token retrieval for mise tools update workflow ([9eed109](https://github.com/navikt/sf-cli-plugin-pool/commit/9eed109745fdf3294584dc431ad6ffdeadb5113e))
* **pool:** enhance pool list command with detailed output and aggregate stats ([90719d0](https://github.com/navikt/sf-cli-plugin-pool/commit/90719d0deae4cf2203d01cd6d1e7ce81ad57bd79))
* **pool:** implement pool clean command to delete scratch orgs ([#55](https://github.com/navikt/sf-cli-plugin-pool/issues/55)) ([a83c0cb](https://github.com/navikt/sf-cli-plugin-pool/commit/a83c0cb7eb074f2a674c170e7a9056c87936ee17))
* **pool:** update pool clean command to normalize status inputs and improve messaging ([4feffc5](https://github.com/navikt/sf-cli-plugin-pool/commit/4feffc52a456f1096cf50040f45aedef9a0afd42))


### Bug Fixes

* add .cplt.toml and update .gitignore for generated files ([7d654c1](https://github.com/navikt/sf-cli-plugin-pool/commit/7d654c150a14dfa7bafaa46f7c339810ac77fa98))
* **ci:** add sf-cli installation step to NUTs workflow ([dcdfd38](https://github.com/navikt/sf-cli-plugin-pool/commit/dcdfd3812fa22041769760277de803bffed5bc94))
* ensure auto_install is enabled in mise configuration ([76833e1](https://github.com/navikt/sf-cli-plugin-pool/commit/76833e1d5b96b9f01f3bf1a018f938275288c477))
* **gitignore:** correct lib path and ensure src/lib is not ignored ([62eaba2](https://github.com/navikt/sf-cli-plugin-pool/commit/62eaba28d23f8289170430800e874eb163a26188))
* **gitignore:** scope lib ignore to root build output only ([4d22782](https://github.com/navikt/sf-cli-plugin-pool/commit/4d2278267c469c3eb713d5bdd06e8176e76ce8f1))
* **package:** remove leading slashes from files array in package.json ([b7ed4fd](https://github.com/navikt/sf-cli-plugin-pool/commit/b7ed4fd68b189440125079375a22c6ffc576e149))
* **pnpm:** tilpass pnpm-versjon via package.json og fjern versjonsoppsett fra workflows ([56a52f0](https://github.com/navikt/sf-cli-plugin-pool/commit/56a52f014a721386da25aa0c80937e0166e36dd5))
* remove unused TESTKIT_HUB_INSTANCE variable from JWT login step ([b811a9f](https://github.com/navikt/sf-cli-plugin-pool/commit/b811a9fafa370003b5816f19201cf2654f72ce56))
* sha og versjonsnummer må matche ([bb74464](https://github.com/navikt/sf-cli-plugin-pool/commit/bb744645f5ef1f986028a36afa72bf8248fd281a))
* sha og versjonsnummer må matche ([0732c9b](https://github.com/navikt/sf-cli-plugin-pool/commit/0732c9beb474f818f23f2fb3c5cb61b4e89d014f))
* **tests:** add TESTKIT_JWT_CLIENT_ID to NUTs environment variables ([f648196](https://github.com/navikt/sf-cli-plugin-pool/commit/f648196fab5c34bc1c05d43dfdc72398cfedec1d))
* **types:** update property names in ScratchOrgInfoRow for consistency ([5f65b1c](https://github.com/navikt/sf-cli-plugin-pool/commit/5f65b1cc1f2c7b45e3be764695be617dc0ae0d7f))
* update build process to use pnpm pack:clean and adjust postpack script ([adf6678](https://github.com/navikt/sf-cli-plugin-pool/commit/adf6678211ae1a49b08651dfb9ca5c38ceacd294))
* update checks in test workflow to use colon syntax ([bba2af2](https://github.com/navikt/sf-cli-plugin-pool/commit/bba2af28811c95970fe1b854017a457efd1fa96c))
* update message loading to use the correct package namespace for pool commands ([abef5d4](https://github.com/navikt/sf-cli-plugin-pool/commit/abef5d4a5ce7fb69619e0f9b768cc06a621153e2))
* update mise tools workflow reference to correct commit hash ([5dec03e](https://github.com/navikt/sf-cli-plugin-pool/commit/5dec03e7fef43299335a336624d5eaec2b95ba5a))
* update mise tools workflow reference to correct commit hash ([3b3ca3a](https://github.com/navikt/sf-cli-plugin-pool/commit/3b3ca3a5c69b3ff768c6d1d59958ed7c0cc003a0))
* update serialize-javascript version to 7.0.3 in lockfile and workspace ([c84c43a](https://github.com/navikt/sf-cli-plugin-pool/commit/c84c43a755d296f7eb31f69fafa1eba8b6ab4d1b))
* **workflow:** remove version specification for pnpm action setup ([cf92b58](https://github.com/navikt/sf-cli-plugin-pool/commit/cf92b581e4fb6fb41ccb2af34371a06631f311e2))


### Miscellaneous Chores

* release 1.0.0 ([aa62044](https://github.com/navikt/sf-cli-plugin-pool/commit/aa62044100ca0e1ab33f135dcd84d384e2806f77))
