# Retry from import

`POST /workflows/:executionId/retry-from-import` is a protected operational action. It
accepts no artifact data from the caller: the server requires a failed parent whose
failed step is `import-postgis` (or a cancelled parent), loads its application-owned source-artifact record,
and authenticates an artifact-worker HEAD request before starting a child execution.
The child is keyed by `retry-import/<parent>/<attempt>` and exposes only the parent
execution id and attempt in the workflow projection.

Recovery is rejected while the PostgreSQL import advisory lock is held, or when the
artifact is absent or has changed. A repeated request returns an existing running or
succeeded child. Failed or cancelled children advance to the next attempt (`N+1`),
while the immutable source metadata is copied into every child.
The source artifact is private and retained according to the artifact worker's
14-day lifecycle. Object keys and checksums are never included in workflow GETs.

## Historical runs

Effect cluster SQL tables are intentionally not queried. Runs created before the
source-artifact table was deployed cannot be retried automatically. An operator must
first perform a reviewed backfill into `workflow_source_artifacts` using an
authenticated R2 `HEAD` for the exact deterministic key derived from the recorded
download idempotency key and provider URL. If that pair cannot be established from
trusted operational records, the run is not eligible; never accept an arbitrary key
from a browser or retry payload. No automatic historical backfill is included.
