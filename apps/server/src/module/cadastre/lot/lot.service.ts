import { eq, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect } from "effect";
import { Db } from "../../../platform/database/client";
import { cadastreLots } from "./lot.model";
import type { CadastreLotRow } from "./lot.model";
import { LotNotFoundError } from "./lot.schema";
import { type MultiPolygonGeometry } from "./lot.geometry.schema";

export type LotResponse = Pick<CadastreLotRow, "id" | "lotNumber"> & {
  readonly geometry: MultiPolygonGeometry | null;
};

interface CadastreServiceContract {
  readonly getLot: (params: {
    readonly id: string;
  }) => Effect.Effect<LotResponse, LotNotFoundError | EffectDrizzleQueryError>;
  readonly getTile: (params: {
    readonly z: number;
    readonly x: number;
    readonly y: number;
  }) => Effect.Effect<Uint8Array, EffectDrizzleQueryError>;
}

export class CadastreService extends Context.Service<CadastreService, CadastreServiceContract>()(
  "CadastreService",
  {
    make: Effect.fn("CadastreService.make")(function* () {
      const db = yield* Db;
      return {
        getLot: Effect.fn("CadastreService.getLot")(function* ({ id }: { readonly id: string }) {
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
          // Bounded execution so a dense tile (e.g. central Sydney at zoom 14)
          // cannot hold a pool connection for minutes.  When the timeout fires
          // the Effect fiber is interrupted, pg_cancel_backend is sent to
          // PostgreSQL, and the connection is returned to the pool – freeing it
          // for queued requests and the cancellation path itself.
          //
          // TimeoutError is caught here and converted to EffectDrizzleQueryError
          // so the single catchTags in the HTTP handler covers all failures.
          const result = yield* db
            .execute<{ tile: Uint8Array }>(
              sql`
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
          `,
            )
            .pipe(
              Effect.timeout("10 seconds"),
              Effect.catchTag("TimeoutError", () =>
                Effect.fail(
                  new EffectDrizzleQueryError({
                    query: "getTile-timeout",
                    params: [z, x, y],
                    cause: undefined,
                  }),
                ),
              ),
            );
          // effect-postgres executes raw SQL through node-postgres and returns its
          // Result object at runtime, despite db.execute's array-shaped type.
          const tile = (
            result as unknown as {
              readonly rows: readonly { readonly tile: Uint8Array }[];
            }
          ).rows[0]?.tile;
          return tile instanceof Uint8Array ? tile : new Uint8Array();
        }),
      };
    })(),
  },
) {}
