# Module repo

Repositories own persistence access and projection queries. `*.repo.ts` may depend on database models/schemas only; it must not import HTTP, workflow, or activity layers.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
