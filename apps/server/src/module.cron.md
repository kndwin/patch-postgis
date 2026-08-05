# Module cron

Cron declarations belong in `*.cron.ts` and should trigger workflows rather than implement business work. Keep timezone and expression explicit.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
