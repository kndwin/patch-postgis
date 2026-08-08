# Cadastre sync workflow

The workflow boundary is `CadastreSyncWorkflow`; its stable activity names are defined in
`apps/server/src/module/cadastre/workflow/cadastre-workflow.workflow.ts`. The protected manual
trigger is `POST /workflows/cadastre-sync` with a Bearer token in
`CADASTRE_WORKFLOW_TRIGGER_TOKEN` and an optional `idempotencyKey`.
Running executions can be stopped with the same token via `POST /workflows/:executionId/cancel`.
The execution ID must be exactly 32 lowercase hex characters. Cancellation is idempotent and
returns `{ "executionId": "...", "status": "cancelled" }`.

Email download-link extraction, source artifact handoff, PostGIS import, validation, atomic
promotion, PMTiles build, multipart upload, final HEAD/public range and metadata verification, and
DB publication are implemented. Remaining work is production deploy/trigger validation, not build
scaffolds.

Activities exchange R2 keys and metadata only. Local filesystem paths stay activity-local and are
never workflow values. The private source artifact lifecycle is 14 days; incomplete tile multipart
uploads are aborted after 1 day. Required production settings are
`CADASTRE_ARTIFACT_URL`/`CADASTRE_ARTIFACT_TOKEN` and
`CADASTRE_TILE_URL`/`CADASTRE_TILE_PUBLISH_TOKEN`.

Production mounts `CADASTRE_WORK_DIR=/data/cadastre` on a 50 GiB Railway work volume for
activity-local ZIP, MBTiles, and PMTiles files. PostGIS uses a 40 GiB data volume for the full
parcel table, spatial index, and transactional replacement.

The download activity hashes `idempotencyKey + NUL + downloadUrl` with SHA-256, downloads the trusted
NSW URL into its Railway-local work directory, and publishes 64 MiB multipart parts to the protected
artifact worker. The worker accepts only validated `runs/<sha256>/source/export.zip` keys and never
fetches provider URLs. Source uploads are capped at 2 GiB, include a SHA-256 custom metadata value,
and are idempotent through authenticated final HEAD. Import verifies size, ETag, archive integrity, FileGDB layout,
and the `Lot` layer. The PMTiles activity runs `pmtiles convert`, `pmtiles verify`,
`show --header-json`, and `show --metadata`, then performs a multipart R2 upload. Completion
metadata and final HEAD are checked, and the verification activity checks public range and metadata
responses before recording the published object key in the database. The status API continues to
serve the newest published snapshot while a replacement remains in the `building` state.

## PMTiles implementation evidence

The completed full-scale fixture contained 3,353,211 features and produced approximately 11 GiB of
MBTiles, then a 3,951,148,805-byte PMTiles v3 archive. Verify passed; the `lots` layer contains
`id` and `lot_number` fields at z14–18. It addressed 60,214,271 tiles and contained 21,656,041
tile entries. Upload completed as a successful 59-part R2 multipart upload. Public range and decoded
MVT tile checks and metadata verification passed. A later redundant run was stopped incomplete and
was not used as evidence. The exact production PostGIS → GeoJSONSeq → tippecanoe → PMTiles command
shape was also exercised against 1,000 real parcels and passed the same layer/field/zoom validators.

The daily schedule is `0 0 2 * * *` (seconds included), in `Australia/Sydney`. `workflow_*` tables
are an application-owned projection, separate from Effect cluster tables; projection writes are handled
by the workflow runtime. The HTTP projection is `/workflows/:id`, `/workflows`, and
`/schedules`.

This is intentionally a single-process deployment: do not run multiple Railway replicas with this
mode. `DATABASE_URL` must point at PostgreSQL and `PORT` controls HTTP.

```sh
SAO_ALLOW_TESTS=1 pnpm --filter @patch/server test
pnpm --filter @patch/server typecheck
git diff --check
```

## Export request delivery

The request-dataset activity claims a PostgreSQL row keyed by the workflow execution ID
before sending the NSW export POST. Only the claim owner sends; replays reconstruct the
activity result from that row. A claim is never deleted after a network or provider error:
the outcome may be ambiguous, so the failed workflow is not automatically retried into a
second export request. A new workflow idempotency key is required to make a new request.
