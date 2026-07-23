import { eq, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Schema } from "effect";
import { Db } from "../../platform/db/client";
import { cadastreImportCheckpoints, cadastreLots } from "./cadastre.model";
import type { CadastreLotRow } from "./cadastre.model";
import { CadastreImportError, LotNotFoundError } from "./cadastre.schema";
import {
  ringsToMultiPolygonCoordinates,
  type MultiPolygonGeometry,
} from "./cadastre.geometry";

export type LotResponse = Pick<CadastreLotRow, "id" | "lotNumber"> & {
  readonly geometry: MultiPolygonGeometry | null;
};
export const SYDNEY_LOT_QUERY =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme_multiCRS/FeatureServer/8/query";
// Exactly one deliberate initial-import area, in WGS84: metropolitan Sydney
// and Western Sydney, not statewide NSW.
// Padded rectangular extent of the official Greater Sydney Region planning
// districts, including the Western City District.
export const GREATER_SYDNEY_REGION_BBOX = "150.00,-34.35,151.35,-32.95";
const SURRY_HILLS_BBOX = "151.205,-33.889,151.214,-33.883";
export const SYDNEY_ID_BATCH_SIZE = 100;
export const SYDNEY_IMPORT_CONCURRENCY = 4;
export const SYDNEY_CHECKPOINT_SOURCE =
  "greater-sydney-region-initial-cadastre-v1";

export const sortSydneyObjectIds = (ids: readonly number[]): number[] =>
  [...ids].sort((left, right) => left - right);

export const nextSydneyObjectIdIndex = (index: number, batchSize: number) =>
  index + batchSize;

const ArcGisFeature = Schema.Struct({
  attributes: Schema.Struct({
    OBJECTID: Schema.Union([Schema.Number, Schema.String]),
    cadid: Schema.Union([Schema.Number, Schema.String]),
    lotidstring: Schema.NullOr(Schema.String),
    lotnumber: Schema.NullOr(Schema.String),
  }),
  geometry: Schema.Struct({
    rings: Schema.Array(Schema.Array(Schema.Array(Schema.Number))),
  }),
});
const ArcGisPage = Schema.Struct({
  features: Schema.Array(ArcGisFeature),
  exceededTransferLimit: Schema.optional(Schema.Boolean),
});
const ArcGisIds = Schema.Struct({ objectIds: Schema.Array(Schema.Number) });
type ArcGisFeature = typeof ArcGisFeature.Type;

const featureGeoJson = (feature: ArcGisFeature) =>
  JSON.stringify({
    type: "MultiPolygon",
    coordinates: ringsToMultiPolygonCoordinates(feature.geometry.rings),
  });

const fetchJson = Effect.fn("CadastreService.fetchJson")(function* (
  params: URLSearchParams,
) {
  const url = new URL(SYDNEY_LOT_QUERY);
  const body = yield* Effect.tryPromise({
    try: async () => {
      // ArcGIS occasionally returns 429/5xx during a large export. Retry only
      // those failures; the cap keeps a bad endpoint from hanging a Railway run.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        let response: Response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: params,
          });
        } catch (cause) {
          if (attempt === 3) throw cause;
          await new Promise((resolve) =>
            setTimeout(resolve, 200 * 2 ** attempt),
          );
          continue;
        }
        if (response.ok) return await response.json();
        const transient = [408, 429, 500, 502, 503, 504].includes(
          response.status,
        );
        if (!transient || attempt === 3)
          throw new Error(`HTTP ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** attempt));
      }
      throw new Error("retry limit reached");
    },
    catch: (cause) =>
      new CadastreImportError({
        message: `Sydney cadastre ArcGIS request failed: ${String(cause)}`,
      }),
  });
  return body;
});

const fetchIds = () =>
  fetchJson(
    new URLSearchParams({
      where: "1=1",
      geometry: SURRY_HILLS_BBOX,
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      returnIdsOnly: "true",
      f: "json",
    }),
  ).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(ArcGisIds)(body)),
    Effect.mapError(
      (cause) =>
        new CadastreImportError({
          message: `Sydney cadastre ArcGIS ID response shape was invalid: ${String(cause)}`,
        }),
    ),
  );

const fetchFeatures = (objectIds: readonly number[]) =>
  fetchJson(
    new URLSearchParams({
      objectIds: objectIds.join(","),
      outFields: "OBJECTID,cadid,lotnumber,lotidstring",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    }),
  ).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(ArcGisPage)(body)),
    Effect.mapError(
      (cause) =>
        new CadastreImportError({
          message: `Sydney cadastre ArcGIS feature response shape was invalid: ${String(cause)}`,
        }),
    ),
  );

const fetchSydneyBatch = (objectIds: readonly number[]) =>
  fetchFeatures(objectIds).pipe(
    Effect.flatMap((page) => {
      if (page.exceededTransferLimit === true)
        return Effect.fail(
          new CadastreImportError({
            message: "Sydney cadastre ArcGIS batch exceeded transfer limit",
          }),
        );
      const returned = new Set(
        page.features.map((feature) => Number(feature.attributes.OBJECTID)),
      );
      const missing = objectIds.filter((id) => !returned.has(id));
      if (missing.length > 0)
        return Effect.fail(
          new CadastreImportError({
            message: `Sydney cadastre ArcGIS batch omitted OBJECTIDs: ${missing.join(",")}`,
          }),
        );
      return Effect.succeed(page);
    }),
  );

interface CadastreServiceContract {
  readonly getLot: (params: {
    readonly id: string;
  }) => Effect.Effect<LotResponse, LotNotFoundError | EffectDrizzleQueryError>;
  readonly getTile: (params: {
    readonly z: number;
    readonly x: number;
    readonly y: number;
  }) => Effect.Effect<Uint8Array, EffectDrizzleQueryError>;
  readonly importSurryHills: () => Effect.Effect<
    {
      readonly fetched: number;
      readonly upserted: number;
      readonly skipped: number;
    },
    CadastreImportError | EffectDrizzleQueryError
  >;
  readonly importSydneyInitial: () => Effect.Effect<
    {
      readonly fetched: number;
      readonly upserted: number;
      readonly skipped: number;
      readonly resumedFrom: number;
    },
    CadastreImportError | EffectDrizzleQueryError
  >;
}

export class CadastreService extends Context.Service<
  CadastreService,
  CadastreServiceContract
>()("CadastreService", {
  make: Effect.gen(function* () {
    const db = yield* Db;
    const upsertBatch = (
      client: typeof db,
      features: readonly ArcGisFeature[],
    ): Effect.Effect<number, EffectDrizzleQueryError> => {
      const valid = features.flatMap((feature) => {
        const lotNumber =
          feature.attributes.lotidstring?.trim() ||
          feature.attributes.lotnumber?.trim() ||
          null;
        return lotNumber === null ? [] : [{ feature, lotNumber }];
      });
      if (valid.length === 0) return Effect.succeed(0);
      return client
        .insert(cadastreLots)
        .values(
          valid.map(({ feature, lotNumber }) => ({
            id: String(feature.attributes.cadid),
            lotNumber,
            geometry: sql`ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON(${featureGeoJson(feature)})), 4326)`,
          })),
        )
        .onConflictDoUpdate({
          target: cadastreLots.id,
          set: {
            lotNumber: sql`excluded.lot_number`,
            geometry: sql`excluded.geometry`,
          },
        })
        .pipe(Effect.as(valid.length));
    };
    return {
      getLot: Effect.fn("CadastreService.getLot")(function* ({
        id,
      }: {
        readonly id: string;
      }) {
        const lot = yield* db
          .select({
            id: cadastreLots.id,
            lotNumber: cadastreLots.lotNumber,
            // Cast to jsonb so node-postgres returns a GeoJSON object rather
            // than the text representation produced by ST_AsGeoJSON.
            geometry: sql<MultiPolygonGeometry | null>`ST_AsGeoJSON(${cadastreLots.geometry})::jsonb`,
          })
          .from(cadastreLots)
          .where(eq(cadastreLots.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));
        if (lot === undefined)
          return yield* new LotNotFoundError({
            id,
            message: `Lot ${id} was not found`,
          });
        return lot;
      }),
      getTile: Effect.fn("CadastreService.getTile")(function* ({ z, x, y }) {
        const result = yield* db.execute<{ tile: Uint8Array }>(sql`
          WITH bounds AS (
            SELECT ST_TileEnvelope(
              ${z},
              ${x},
              ${y}
            ) AS geom
          ),
          mvtgeom AS (
            SELECT l.id, l.lot_number,
              ST_AsMVTGeom(ST_Transform(l.geometry, 3857), bounds.geom, 4096, 64, true) AS geometry
            FROM cadastre_lots AS l CROSS JOIN bounds
            WHERE l.geometry IS NOT NULL
              AND l.geometry && ST_Transform(bounds.geom, 4326)
          )
          SELECT COALESCE(ST_AsMVT(mvtgeom, 'lots', 4096, 'geometry'), ''::bytea) AS tile
          FROM mvtgeom
          WHERE geometry IS NOT NULL
        `);
        // effect-postgres executes raw SQL through node-postgres and returns its
        // Result object at runtime, despite db.execute's array-shaped type.
        const tile = (
          result as unknown as {
            readonly rows: readonly { readonly tile: Uint8Array }[];
          }
        ).rows[0]?.tile;
        return tile instanceof Uint8Array ? tile : new Uint8Array();
      }),
      importSurryHills: Effect.fn("CadastreService.importSurryHills")(
        function* () {
          const ids = yield* fetchIds();
          let fetched = 0;
          let upserted = 0;
          let skipped = 0;
          for (
            let start = 0;
            start < ids.objectIds.length;
            start += SYDNEY_ID_BATCH_SIZE
          ) {
            const page = yield* fetchSydneyBatch(
              ids.objectIds.slice(start, start + SYDNEY_ID_BATCH_SIZE),
            );
            fetched += page.features.length;
            if (page.features.length > 0) {
              // One page is fetched before writes; this keeps network and SQL
              // work coarse without introducing a repository abstraction.
              upserted += yield* upsertBatch(db, page.features);
              skipped += page.features.filter(
                ({ attributes }) =>
                  !(
                    attributes.lotidstring?.trim() ||
                    attributes.lotnumber?.trim()
                  ),
              ).length;
            }
          }
          return { fetched, upserted, skipped };
        },
      ),
      importSydneyInitial: Effect.fn("CadastreService.importSydneyInitial")(
        function* () {
          const checkpoint = yield* db
            .select()
            .from(cadastreImportCheckpoints)
            .where(
              eq(cadastreImportCheckpoints.source, SYDNEY_CHECKPOINT_SOURCE),
            )
            .limit(1)
            .pipe(Effect.map((rows) => rows[0]));
          let objectIds = checkpoint?.objectIds;
          if (objectIds === undefined) {
            const ids = yield* fetchJson(
              new URLSearchParams({
                where: "1=1",
                geometry: GREATER_SYDNEY_REGION_BBOX,
                geometryType: "esriGeometryEnvelope",
                inSR: "4326",
                spatialRel: "esriSpatialRelIntersects",
                returnIdsOnly: "true",
                f: "json",
              }),
            ).pipe(
              Effect.flatMap((body) =>
                Schema.decodeUnknownEffect(ArcGisIds)(body),
              ),
              Effect.mapError(
                (cause) =>
                  new CadastreImportError({
                    message: `Sydney cadastre ArcGIS ID response shape was invalid: ${String(cause)}`,
                  }),
              ),
            );
            objectIds = sortSydneyObjectIds(ids.objectIds);
            // The snapshot is durable before any feature request. A resume uses
            // this exact set and never performs a second ID discovery.
            yield* db.insert(cadastreImportCheckpoints).values({
              source: SYDNEY_CHECKPOINT_SOURCE,
              objectIds,
              completed: objectIds.length === 0,
            });
          }
          let nextIndex = checkpoint?.nextObjectIdIndex ?? 0;
          let fetched = checkpoint?.fetched ?? 0;
          let upserted = checkpoint?.upserted ?? 0;
          let skipped = checkpoint?.skipped ?? 0;
          const resumedFrom = nextIndex;
          if (checkpoint?.completed)
            return { fetched, upserted, skipped, resumedFrom };
          yield* Effect.log(
            `Sydney + Western Sydney cadastre import starting at OBJECTID index ${nextIndex}`,
          );
          while (nextIndex < objectIds.length) {
            const starts = Array.from(
              {
                length: Math.min(
                  SYDNEY_IMPORT_CONCURRENCY,
                  Math.ceil(
                    (objectIds.length - nextIndex) / SYDNEY_ID_BATCH_SIZE,
                  ),
                ),
              },
              (_, waveIndex) => nextIndex + waveIndex * SYDNEY_ID_BATCH_SIZE,
            );
            const pages = yield* Effect.all(
              starts.map((start) =>
                fetchSydneyBatch(
                  objectIds.slice(start, start + SYDNEY_ID_BATCH_SIZE),
                ),
              ),
              { concurrency: SYDNEY_IMPORT_CONCURRENCY },
            );
            const pageFetched = pages.reduce(
              (sum, page) => sum + page.features.length,
              0,
            );
            const pageSkipped = pages.reduce(
              (sum, page) =>
                sum +
                page.features.filter(
                  ({ attributes }) =>
                    !(
                      attributes.lotidstring?.trim() ||
                      attributes.lotnumber?.trim()
                    ),
                ).length,
              0,
            );
            const nextIndexAfterWave = Math.min(
              nextIndex + pages.length * SYDNEY_ID_BATCH_SIZE,
              objectIds.length,
            );
            const wave = yield* db
              .transaction((tx) =>
                Effect.gen(function* () {
                  const pageUpserted = yield* upsertBatch(
                    tx as unknown as typeof db,
                    pages.flatMap((page) => page.features),
                  );
                  const nextFetched = fetched + pageFetched;
                  const nextUpserted = upserted + pageUpserted;
                  const nextSkipped = skipped + pageSkipped;
                  yield* tx
                    .update(cadastreImportCheckpoints)
                    .set({
                      nextObjectIdIndex: nextIndexAfterWave,
                      fetched: nextFetched,
                      upserted: nextUpserted,
                      skipped: nextSkipped,
                      completed: nextIndexAfterWave >= objectIds.length,
                    })
                    .where(
                      eq(
                        cadastreImportCheckpoints.source,
                        SYDNEY_CHECKPOINT_SOURCE,
                      ),
                    );
                  return { nextFetched, nextUpserted, nextSkipped };
                }),
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new CadastreImportError({
                      message: `Sydney cadastre transaction failed: ${String(cause)}`,
                    }),
                ),
              );
            fetched = wave.nextFetched;
            upserted = wave.nextUpserted;
            skipped = wave.nextSkipped;
            nextIndex = nextIndexAfterWave;
            yield* Effect.log(
              `Sydney + Western Sydney cadastre progress: fetched=${fetched} upserted=${upserted} skipped=${skipped} nextObjectIdIndex=${nextIndex}`,
            );
          }
          return { fetched, upserted, skipped, resumedFrom };
        },
      ),
    };
  }),
}) {}
