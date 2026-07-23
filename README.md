# Patch PostGIS

Checkpoint 3 is a small Bun + TypeScript service using Effect v4's unstable
`HttpApi`, with a real Drizzle PostgreSQL configuration and a PostGIS development
database. The v4 beta packages are pinned together because the HTTP APIs remain
unstable.

## Start

```sh
bun install
cp .env.example .env
docker compose up -d postgres
bun dev
```

The process-level health endpoint does not require the database to be available:

```sh
curl -i http://localhost:3000/health
curl -i http://localhost:3000/openapi.json
curl -i http://localhost:3000/docs
```

Expected health response: `{"status":"ok"}`. The generated OpenAPI document and
Scalar documentation UI are available at the other two URLs. `DATABASE_URL`
configures both `src/platform/db/client.ts` and Drizzle Kit; the service deliberately does
not query the database from `/health`.

## Real Sydney parcel import

`bun run import` performs one bounded import and exits. It queries the official
NSW Spatial Services ArcGIS REST **Lot (layer 8)** service from the official
[NSW Land Parcel and Property Theme multiCRS](https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme_multiCRS/FeatureServer/8).
The hardcoded WGS84 envelope is `151.205,-33.889,151.214,-33.883` (Surry
Hills, NSW). Source `cadid` is stored as the lot `id`. The display
`lot_number` uses `lotidstring`, falling back to `lotnumber`; features with
neither are skipped and reported (no synthetic `UNNUMBERED` value is created).
Geometry is requested in EPSG:4326 and ingested as `MultiPolygon(4326)`. To
avoid unstable offsets, the importer first requests all IDs for the bbox, then
fetches those IDs in chunks of 100. `fetched` counts returned features,
`upserted` counts rows with a usable lot number, and `skipped` counts missing-number
features.

```sh
docker compose up -d postgres
bunx drizzle-kit migrate
bun run import
docker compose exec -T postgres psql -U postgres -d patch_postgis -c 'select count(*) from cadastre_lots;'
```

This is intentionally not a synchronizer: it imports only this documented box
and has no authentication, workflow, reconciliation, or generic ArcGIS layer.

### Sydney + Western Sydney initial import

`bun run import:sydney` imports the official layer 8 (`_multiCRS`) features that
intersect this fixed WGS84 envelope: **`150.00,-34.35,151.35,-32.95`**
(`xmin,ymin,xmax,ymax`). This padded rectangular extent covers the official
Greater Sydney Region planning districts, including the Western City District;
it is not a statewide import. A live source count on 23 July 2026 returned about
1.43 million lots. The importer sends the envelope as ArcGIS
`geometry` with `geometryType=esriGeometryEnvelope`, `inSR=4326`, and
`spatialRel=esriSpatialRelIntersects`. It first takes exactly one
`returnIdsOnly=true` snapshot, sorts OBJECTIDs numerically, and durably stores
that snapshot in `cadastre_import_checkpoints`. Feature requests are POSTs of
100 IDs, in waves of four; each response must return every requested OBJECTID
and must not set `exceededTransferLimit`. A wave's upserts and checkpoint
advancement are one transaction. Only the ID snapshot plus one four-batch wave
is retained in memory. If Railway stops, rerun the same command: it resumes from
the durable ID index and never discovers a new snapshot.
Transient ArcGIS 408/429/5xx responses are retried with a bounded backoff; other
failures terminate with a nonzero exit. The checkpoint is specific to this initial
snapshot, so it is not a reconciliation or synchronization mechanism.

On Railway, first deploy/apply the migration, then run this as a one-off job in the
app service (with the app's `DATABASE_URL`):

```sh
railway ssh --service app --environment production -- \
  "sh -lc 'cd /app && bunx drizzle-kit migrate'"
railway ssh --service app --environment production -- \
  "sh -lc 'cd /app && bun run import:sydney'"
```

Run it from a reviewed Railway environment, keep the process logs, and do not run
multiple imports concurrently. `fetched`, `upserted`, and `skipped` are cumulative
checkpoint counters; source count is measured by the importer logs, not guessed.
Useful verification queries are:

```sql
SELECT source, next_object_id_index, cardinality(object_ids) AS snapshot_ids,
       fetched, upserted, skipped, completed
FROM cadastre_import_checkpoints
WHERE source = 'greater-sydney-region-initial-cadastre-v1';
SELECT count(*) AS lots, count(geometry) AS geometries FROM cadastre_lots;
SELECT ST_SRID(geometry), count(*) FROM cadastre_lots GROUP BY 1;
SELECT count(*) FROM cadastre_lots WHERE geometry IS NULL;
```

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

## Fake lot retrieval

Start PostGIS, apply the migration, then insert a fake lot for manual verification:

```sh
docker compose up -d postgres
bunx drizzle-kit migrate
docker compose exec -T postgres psql -U postgres -d patch_postgis -c "insert into cadastre_lots (id, lot_number) values ('123', 'FAKE-123') on conflict (id) do update set lot_number = excluded.lot_number;"
bun run start
curl -i http://localhost:3000/lots/123
curl -i http://localhost:3000/lots/missing
```

The response is `{ "id": "123", "lotNumber": "FAKE-123", "geometry": null }`.
Imported lots include a GeoJSON `MultiPolygon` geometry in this field; it is null
for rows created without geometry. The API uses `ST_AsGeoJSON` in the lookup
query, while the GiST index remains available for spatial queries.

The application uses Drizzle ORM `1.0.0-rc.4` through its
`drizzle-orm/effect-postgres` integration and Effect SQL PostgreSQL
`@effect/sql-pg` `4.0.0-beta.100`. The runtime database layer is `PgClient`; no
postgres-js client is used. Domain and infrastructure failures are
schema-backed `Schema.TaggedErrorClass` errors, and the API keeps typed 404
and 500 responses separate.

Feature-module conventions follow the Effect service layout: `cadastre.model.ts`
owns the Drizzle table and `cadastre.model.schema.ts` owns its derived schema,
while `cadastre.schema.ts` owns domain and infrastructure tagged errors.
`cadastre.http.schema.ts` owns the HTTP request/response schemas and endpoint
group contract, `cadastre.http.define.ts` exposes that contract, and
`cadastre.http.live.ts` binds it to the service. `api.define.ts` composes
the application contract while `api.live.ts` supplies shared HTTP infrastructure
and live layers. `CadastreService` uses the Effect Drizzle
`Db` directly for this simple lookup; there is no repository layer yet. Drizzle
Kit continues to consume the stable export at `src/platform/db/schema.ts`.

Useful checks:

```sh
bun run typecheck
bun run lint
bunx prettier --check .
```

## Railway deployment (native IaC)

The experimental Railway IaC definition is in `.railway/railway.ts`. It declares
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

Railway runs `bunx drizzle-kit migrate` automatically as the app's pre-deploy
step, before the new app deployment is activated. The migration command uses the
app's `DATABASE_URL`, and migrations are already committed under `drizzle/`.
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
