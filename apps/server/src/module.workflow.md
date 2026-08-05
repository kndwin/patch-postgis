# Module workflow

Workflow definitions describe durable orchestration only. Keep handlers and idempotency in `*.workflow.ts`; do not activate runtimes in `main.ts` until their required engine is provided.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
