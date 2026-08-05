# Module activity

Activities are explicit external-work boundaries. Name activity contracts in `*.activity.ts`, keep them independently retryable, and do not hide network or process work in services.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
