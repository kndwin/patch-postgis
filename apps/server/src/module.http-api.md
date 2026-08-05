# Module http-api

HTTP API contracts are defined in `@patch/http-contract`; handlers use `*.http-api.live.ts`. Local parsing helpers should use descriptive module names. Preserve route and group names when reorganizing.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
