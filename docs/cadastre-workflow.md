# Cadastre sync workflow scaffold

The workflow boundary is `CadastreSyncWorkflow` and its stable activity names are
defined in `apps/server/src/module/cadastre/workflow/cadastre.workflow.ts`.
Downloads, GDAL/PostGIS import, PMTiles and object storage remain intentionally
unimplemented. The request step calls the configured export provider and the
email step polls the ingestion database; downstream work still fails with
`CadastreWorkflowNotImplemented`.

Export requests use `CADASTRE_EXPORT_EMAIL`, defaulting to
`cadastre-export-staging@decoco.work`. The wait step matches that recipient and
only accepts ingestion rows received after the request started. It performs 13
durable lookups, 30 minutes apart, covering up to six hours. The server
bootstraps an Effect workflow runtime, so this polling is persisted in
PostgreSQL and survives process restarts.

The daily schedule is `0 0 2 * * *` (seconds included), in
`Australia/Sydney`. `workflow_*` tables are an application-owned projection;
they are not Effect cluster tables and do not make the old `sync_runs` table
authoritative. The read-only HTTP projection is `/workflows/:id`, `/workflows`,
and `/schedules`, with a 25 default and 100 maximum limit. Cursor encoding and
SQL projection writes are the next incremental step; the current empty
projection is truthful and does not report successful production work.

The runtime uses Effect beta.102's `SingleRunner.layer({ runnerStorage: "sql" })`,
`ClusterWorkflowEngine.layer`, and Bun crypto. `DATABASE_URL` must point at
PostgreSQL (the local fallback is for development), and `PORT` controls HTTP.
SingleRunner's SQL message and runner storage install their own cluster tables
and migrations at startup. These are separate from the application-owned
`workflow_*` projection tables.

This is intentionally a single-process deployment: runner communication and
health checks are local no-ops. Do not run multiple Railway replicas with this
mode. Multi-replica support would require a socket/cluster transport and is a
separate deployment mode, not an implicit property of PostgreSQL storage.

The daily cron is registered at startup and runs at `02:00` Australia/Sydney.
The workflow is registered in the same runtime, so a future manual HTTP trigger
can execute it through the durable engine. Verify startup and persistence with:

```sh
pnpm --filter @patch/server start
psql "$DATABASE_URL" -c '\\dt *workflow*' -c '\\dt *cluster*'
curl http://localhost:${PORT:-3000}/workflows
```

## Validation

```sh
pnpm --filter @patch/server typecheck
pnpm --filter @patch/browser typecheck
pnpm --filter @patch/browser exec vite build
git diff --check
SAO_ALLOW_TESTS=1 pnpm --filter @patch/server test
```

Set `VITE_MOCK_SYNC=true` only for browser fixture mode. Production browser mode
calls the API and displays an unavailable state on errors.
