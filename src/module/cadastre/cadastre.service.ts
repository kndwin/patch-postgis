import { eq, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Schema } from "effect";
import { Db } from "../../platform/db/client";
import { cadastreLots } from "./cadastre.model";
import type { CadastreLotRow } from "./cadastre.model";
import { CadastreImportError, LotNotFoundError } from "./cadastre.schema";
import { ringsToMultiPolygonCoordinates } from "./cadastre.geometry";

type LotResponse = Pick<CadastreLotRow, "id" | "lotNumber">;
export const NSW_LOT_QUERY =
  "https://portal.spatial.nsw.gov.au/server/rest/services/NSW_Land_Parcel_Property_Theme_multiCRS/FeatureServer/8/query";
// Exactly one deliberate import area: Surry Hills, NSW, in WGS84.
const SURRY_HILLS_BBOX = "151.205,-33.889,151.214,-33.883";
const ID_CHUNK_SIZE = 100;

const ArcGisFeature = Schema.Struct({
  attributes: Schema.Struct({
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
  const url = new URL(NSW_LOT_QUERY);
  url.search = params.toString();
  const response = yield* Effect.tryPromise({
    try: () => fetch(url),
    catch: (cause) =>
      new CadastreImportError({
        message: `NSW ArcGIS request failed: ${String(cause)}`,
      }),
  });
  if (!response.ok)
    return yield* new CadastreImportError({
      message: `NSW ArcGIS returned HTTP ${response.status}`,
    });
  const body = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: (cause) =>
      new CadastreImportError({
        message: `NSW ArcGIS response was not JSON: ${String(cause)}`,
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
          message: `NSW ArcGIS ID response shape was invalid: ${String(cause)}`,
        }),
    ),
  );

const fetchFeatures = (objectIds: readonly number[]) =>
  fetchJson(
    new URLSearchParams({
      objectIds: objectIds.join(","),
      outFields: "cadid,lotnumber,lotidstring",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
    }),
  ).pipe(
    Effect.flatMap((body) => Schema.decodeUnknownEffect(ArcGisPage)(body)),
    Effect.mapError(
      (cause) =>
        new CadastreImportError({
          message: `NSW ArcGIS feature response shape was invalid: ${String(cause)}`,
        }),
    ),
  );

interface CadastreServiceContract {
  readonly getLot: (params: {
    readonly id: string;
  }) => Effect.Effect<LotResponse, LotNotFoundError | EffectDrizzleQueryError>;
  readonly importSurryHills: () => Effect.Effect<
    {
      readonly fetched: number;
      readonly upserted: number;
      readonly skipped: number;
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
          .select({ id: cadastreLots.id, lotNumber: cadastreLots.lotNumber })
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
      importSurryHills: Effect.fn("CadastreService.importSurryHills")(
        function* () {
          const ids = yield* fetchIds();
          let fetched = 0;
          let upserted = 0;
          let skipped = 0;
          for (
            let start = 0;
            start < ids.objectIds.length;
            start += ID_CHUNK_SIZE
          ) {
            const page = yield* fetchFeatures(
              ids.objectIds.slice(start, start + ID_CHUNK_SIZE),
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
    };
  }),
}) {}
