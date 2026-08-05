# Module live

Live files provide runtime implementations and layers. Keep service tags stable and wire only capabilities that are actually available.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
