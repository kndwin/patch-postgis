# Module schema

Schemas validate transport and domain data. Keep `*.schema.ts` free of runtime orchestration and database side effects.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
