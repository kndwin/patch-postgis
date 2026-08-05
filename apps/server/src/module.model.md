# Module model

Models are persistence table declarations and row types in `*.model.ts`. They preserve table and column names and depend on no higher application layer.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
