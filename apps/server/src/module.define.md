# Module define

Definition files compose public contracts (HTTP or other declarations) without wiring runtime implementations.

Architecture checks run through `pnpm --filter @patch/server lint`, using the `effect-oxlint` plugin configured in the repository `.oxlintrc.json`. The rule validates concern folders and approved filename suffixes.
