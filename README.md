# Patch PostGIS

This pnpm workspace contains a Bun + TypeScript service and a Vite SPA using Effect v4's unstable
`HttpApi`, with a real Drizzle PostgreSQL configuration and a PostGIS development
database. The v4 beta packages are pinned together because the HTTP APIs remain
unstable.

## Start

```sh
pnpm install
cp apps/server/.env.example apps/server/.env
docker compose up -d postgres
pnpm dev
```

The process-level health endpoint does not require the database to be available:

```sh
curl -i http://localhost:3000/health
curl -i http://localhost:3000/openapi.json
curl -i http://localhost:3000/docs
```

Expected health response: `{"status":"ok"}`. The generated OpenAPI document and
Scalar documentation UI are available at the other two URLs. `DATABASE_URL`
configures both `apps/server/src/platform/database/client.ts` and Drizzle Kit; the service deliberately does
not query the database from `/health`.

## Vector tiles

Cadastre parcels are served as Mapbox Vector Tiles:

```sh
curl -sS -D /tmp/tile.headers \
  http://localhost:3000/tiles/13/7536/4916.mvt \
  -o /tmp/surry-hills.mvt
```

The response content type is `application/vnd.mapbox-vector-tile`. The tile
contains a `lots` layer with `id` and `lot_number` properties. Zoom must be from
0 through 22, and x/y must be valid XYZ coordinates for that zoom. Valid tiles
without parcels return `200` with an empty MVT body.

## ArcGIS compatibility query

The bridge exposes a deliberately small ArcGIS REST-compatible endpoint for
clients that already know the public cadastre layer URL. It supports only a
single safe CADID equality predicate, GeoJSON in WGS84, and `outFields=*`:

```sh
curl -sS 'http://localhost:3000/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query?where=CADID%3D123&outFields=*&returnGeometry=true&f=geojson&outSR=4326'
```

The response is a GeoJSON `FeatureCollection`; each feature has `id`, the
stored MultiPolygon geometry (or `null` when `returnGeometry=false`), and
`CADID`/`LotDescription` properties. Unknown CADIDs return an empty collection.
Malformed or unsupported query values return typed HTTP 400 responses. CORS is
applied by the same server middleware as the other GET endpoints.

## Fake lot retrieval

Start PostGIS, apply the migration, then insert a fake lot for manual verification:

```sh
docker compose up -d postgres
pnpm --filter @patch/server exec drizzle-kit migrate
docker compose exec -T postgres psql -U postgres -d patch_postgis -c "insert into cadastre_lots (id, lot_number) values ('123', 'FAKE-123') on conflict (id) do update set lot_number = excluded.lot_number;"
pnpm --filter @patch/server start
curl -i http://localhost:3000/lots/123
curl -i http://localhost:3000/lots/missing
```

The response is `{ "id": "123", "lotNumber": "FAKE-123", "geometry": null }`.
Imported lots include a GeoJSON `MultiPolygon` geometry in this field; it is null
for rows created without geometry. The API uses `ST_AsGeoJSON` in the lookup
query, while the GiST index remains available for spatial queries.

The application uses Drizzle ORM `1.0.0-rc.4` through its
`drizzle-orm/effect-postgres` integration and Effect SQL PostgreSQL
`@effect/sql-pg` `4.0.0-beta.102`. The runtime database layer is `PgClient`; no
postgres-js client is used. Domain and infrastructure failures are
schema-backed `Schema.TaggedErrorClass` errors, and the API keeps typed 404
and 500 responses separate.

Feature-module conventions follow the Effect service layout: `cadastre.model.ts`
owns the Drizzle table and `cadastre.model.schema.ts` owns its derived schema,
while `cadastre.schema.ts` owns domain and infrastructure tagged errors.
The shared `@patch/http-contract` package owns HTTP request/response schemas
and endpoint group contracts. Module `*.http-api.live.ts` files bind those
contracts to services, while `api.live.ts` supplies shared HTTP infrastructure
and live layers. `CadastreService` uses the Effect Drizzle
`Db` directly for this simple lookup; there is no repository layer yet. Drizzle
Kit continues to consume the stable export at `apps/server/src/platform/database/schema.ts`.

Useful checks:

```sh
pnpm typecheck
pnpm check
pnpm format
```

## Cadastre sync

### Browser status modes

The browser dashboard is status-only wiring. It does not trigger or perform
downloads, GDAL imports, PMTiles builds, or uploads.

- Production API mode is the default. Set `VITE_API_URL` and leave
  `VITE_MOCK_SYNC=false`; the dashboard calls `/snapshots/current` and
  `/sync/runs` and shows empty or unavailable data truthfully.
- Mock mode is explicit. Set `VITE_MOCK_SYNC=true` to display the documented
  pipeline fixture. The fixture is labeled and does not represent work being
  performed.

PMTiles are rendered only when a real published URL is supplied by the API or
`VITE_PMTILES_URL`. An unset URL does not fall back to a fake archive or tile
source.

The sync CLI imports cadastre parcels from a local ESRI File Geodatabase
(`.gdb` directory) into the running PostGIS instance. It imports only the
`Lot` layer, stages new rows in a fixed `cadastre_lots_staging` table,
validates the result (rejecting zero-row snapshots), then atomically
promotes the staging table in place of the live `cadastre_lots` table.
Existing API routes (vector tiles, ArcGIS compatibility query, lot lookup)
continue to serve the previous snapshot during sync and reflect the new data
immediately after the promotion commits.

### GDAL requirement

When running directly on the host (not inside Docker), the sync CLI shells
out to `ogr2ogr` from GDAL ≥ 3.6 with the OpenFileGDB driver. Install it:

```sh
# macOS
brew install gdal

# Debian / Ubuntu
sudo apt-get install -y gdal-bin
```

The Docker image already includes `gdal-bin`; no extra setup is needed inside
the container.

### Choosing the GDB source

The sync CLI resolves the FileGDB directory in this order:

1. **CLI argument** — `pnpm --filter @patch/server sync /data/NSW_Cadastre.gdb`
2. **Environment variable** — `CADASTRE_FILEGDB_PATH` in `.env`
3. **Fallback discovery** — newest `*.gdb` directory under `~/Downloads`

```sh
# Explicit path (highest priority)
pnpm --filter @patch/server sync /data/NSW_Cadastre.gdb

# Use CADASTRE_FILEGDB_PATH from .env
CADASTRE_FILEGDB_PATH=/data/NSW_Cadastre.gdb pnpm --filter @patch/server sync

# Fallback: auto-discover newest *.gdb in ~/Downloads
pnpm --filter @patch/server sync
```

### Snapshot and staging

Each sync run follows these steps:

1. Clean up any stale staging table from a previous failed run.
2. Create the `cadastre_lots_staging` table with the exact DDL contract
   (`id text PRIMARY KEY`, `lot_number text NOT NULL`,
   `geometry geometry(MultiPolygon,4326)`).
3. Run `ogr2ogr` against the `Lot` layer, appending rows into the pre-created
   staging table. The layer query renames `cadid` → `id` and
   `lotidstring` → `lot_number`, reprojects from EPSG:7844 to EPSG:4326,
   and promotes single polygons to MultiPolygon.
4. Build a GiST spatial index on the staging geometry column.
5. Count the imported rows. An empty snapshot is rejected; the typed
   staging DDL already constrains every geometry to `MultiPolygon,4326`.
6. Inside a single PostgreSQL transaction: drop the live `cadastre_lots`
   table, rename `cadastre_lots_staging` to `cadastre_lots`, and rename the
   index to match the canonical `cadastre_lots_geometry_idx` name. The swap
   is atomic — other sessions see either the old or the new table, never an
   in-between state.
7. If the sync fails before promotion, the live `cadastre_lots` table is
   untouched. The staging table may persist on disk; the next sync run cleans
   it up automatically (`DROP TABLE IF EXISTS`).

No downtime is required, and existing API routes continue to return results
from the previous snapshot throughout the sync.

### Post-sync verification

After a successful sync the existing endpoints work against the new data:

```sh
curl -i http://localhost:3000/health
curl -sS 'http://localhost:3000/tiles/13/7536/4916.mvt' -o /tmp/tile.mvt
curl -sS 'http://localhost:3000/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query?where=CADID%3D123&outFields=*&returnGeometry=true&f=geojson&outSR=4326'
```

The sync status API exposes the last promoted version and newest-first run
records. A snapshot is recorded only after the table promotion commits:

```sh
curl -sS http://localhost:3000/snapshots/current
curl -sS http://localhost:3000/sync/runs
```

`pmtilesStatus` is currently `not_implemented`; the service never reports a
PMTiles archive as uploaded when no adapter has performed that work.
Sync triggering remains CLI-only for now; no unauthenticated HTTP trigger was
added, and an authenticated internal POST should be introduced together with
the deployment secret and request-signing policy.

### Three-day GDB to tiles flow

The intended production handoff is deliberately split into three observable
days/phases:

1. **Day 1: download and stage.** Download the authoritative FileGDB into a
   controlled workspace, verify its checksum and expected `Lot` layer, then
   run the local CLI. The coordinator records source resolution, staging, and
   GDB import in `cadastre_sync_runs`.
2. **Day 2: import and validate.** GDAL imports `Lot` into PostGIS, the row
   count and geometry contract are checked, and the live table is atomically
   promoted. A versioned `cadastre_snapshots` row is written only after this
   succeeds; failed runs remain visible with `status=failed`.
3. **Day 3: build and publish tiles.** Build a PMTiles archive from the
   promoted snapshot, validate it, upload it to the configured object store,
   and then add an adapter to update `pmtilesStatus` and `pmtilesUrl`. Download,
   PMTiles build, and upload adapters are not implemented in this repository,
   so this final day must currently be operated explicitly rather than inferred
   from a successful database import.

Alchemy v2 is installed at the workspace root and its CLI is available through
`bun alchemy`. Cloudflare resources are separated by environment:
`infra/dev/cloudflare.ts` owns development/staging resources and
`infra/prod/cloudflare.ts` owns production resources. Worker application logic
lives under `apps/server/src/platform/cloudflare/`; infrastructure files only
declare resources and entrypoints.

## Railway deployment (native IaC)

The Railway IaC definition is in `infra/prod/railway.ts`. It declares
the `app` service and a PostGIS service running `postgis/postgis:16-3.4`.

Before planning or applying, create the **shared** environment variable
`POSTGRES_PASSWORD` in Railway. The IaC file references that existing shared
variable; it does not contain, generate, or manage a password. The app receives a
`DATABASE_URL` reference from the PostGIS service, and its IaC source explicitly
targets the GitHub repository `kndwin/patch-postgis`. If creating a new app service
rather than managing the existing one, ensure that repository is available to the
linked Railway GitHub integration.

The supplied target is project `8eadb4cb-3312-440e-93ea-01dcc53860ad` and
environment `db955324-45af-4615-b1f0-02b5c1eb482c`. Link locally with the Railway
CLI (the CLI accepts IDs; use the interactive prompts if your installed version
does not accept the flags):

```sh
railway login
railway link --project 8eadb4cb-3312-440e-93ea-01dcc53860ad \
  --environment db955324-45af-4615-b1f0-02b5c1eb482c
railway config plan
railway config apply
```

`config plan` is read-only. `config apply` prompts before changing Railway; do
not use it until the plan has been reviewed. No Railway link metadata or secrets
should be committed. In particular, do not commit `.railway/link.json`, tokens,
or a local Railway config generated by an older CLI. This project does not use
`railway.json`/`railway.toml`, so the service is not managed by two Railway config
systems.

Railway runs `pnpm --filter @patch/server exec drizzle-kit migrate --config apps/server/drizzle.config.ts` automatically as the app's pre-deploy
step, before the new app deployment is activated. The migration command uses the
app's `DATABASE_URL`, and migration history is committed under `apps/server/src/platform/database/migration/`.
The PostGIS service has a native Railway `postgis-data` volume, explicitly sized
at 4,096 MB and mounted at `/var/lib/postgresql/data`; `PGDATA` points to the
image's `/var/lib/postgresql/data/pgdata` subdirectory. Both the PostGIS service
and volume, as well as the app service, default to Singapore's current Railway
region ID `asia-southeast1-eqsg3a`. Railway volumes are regional and must be
co-located with their service.

> **IMPORTANT: review before applying.** This change moves the existing `postgis-data`
> volume from `us-west2` to Singapore (`asia-southeast1-eqsg3a`). Expect downtime,
> and treat the move as a potentially destructive data migration: take and verify
> a backup first, review the complete plan, and confirm the recovery procedure.
> Do **not** apply blindly. Decreasing the volume size, deleting or detaching the
> volume, or changing its region can destroy persisted PostgreSQL data. The PostGIS
> image is suitable for this development checkpoint, not a substitute for managed
> database backups, upgrades, and durability planning.

# Local development

Run the browser and API through Portless:

```sh
pnpm dev
```

- Browser: https://browser.localhost/dashboard/cadastre
- API: https://api.localhost/health

To view the sync-attempt fixture without a database:

```sh
pnpm --filter @patch/browser dev:mock
```

If Portless has not been trusted on this machine, run `pnpm exec portless trust`
and then `pnpm dev` again.
