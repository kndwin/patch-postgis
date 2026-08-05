# Module service

Services expose application capabilities through Effect service identities. `*.service.ts` may depend on repositories, database clients, and schemas, but not HTTP or workflow composition.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
