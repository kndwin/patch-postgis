import { describe, expect, test } from "bun:test";
import { Effect, Layer, Schema } from "effect";
import { CadastreService } from "./cadastre.service";
import { DbLive } from "../../platform/db/client";
import {
  ArcgisFeatureCollectionSchema,
  LotResponseSchema,
  parseArcgisQuery,
  TileResponseSchema,
} from "./cadastre.http.schema";

// Tile integration tests require a running PostGIS database with synced
// cadastre data.  Opt in by setting the env var before running the suite:
//   CADASTRE_INTEGRATION_TEST=true bun test
const runIntegration = process.env.CADASTRE_INTEGRATION_TEST === "true";

describe("lot GeoJSON response", () => {
  test("accepts a MultiPolygon geometry returned by PostGIS", () => {
    const response = Schema.decodeUnknownSync(LotResponseSchema)({
      id: "123",
      lotNumber: "1/DP123",
      geometry: {
        type: "MultiPolygon",
        coordinates: [
          [
            [
              [151.2, -33.9],
              [151.2, -33.8],
              [151.3, -33.8],
              [151.2, -33.9],
            ],
          ],
        ],
      },
    });

    expect(response.geometry?.type).toBe("MultiPolygon");
    expect(response.geometry?.coordinates).toHaveLength(1);
  });

  test("allows null geometry for legacy or incomplete rows", () => {
    expect(
      Schema.decodeUnknownSync(LotResponseSchema)({
        id: "123",
        lotNumber: "1/DP123",
        geometry: null,
      }).geometry,
    ).toBeNull();
  });
});

describe("ArcGIS query compatibility", () => {
  const valid = {
    where: "CADID=123",
    outFields: "*",
    returnGeometry: "true",
    f: "geojson",
    outSR: "4326",
  };

  test("accepts the supported query and produces a typed id", () => {
    expect(parseArcgisQuery(valid)).toEqual({
      _tag: "Valid",
      id: "123",
      returnGeometry: true,
    });
  });

  test("rejects injection and unsupported values", () => {
    expect(parseArcgisQuery({ ...valid, where: "CADID=123 OR 1=1" })._tag).toBe(
      "Invalid",
    );
    expect(parseArcgisQuery({ ...valid, f: "json" })._tag).toBe("Invalid");
    expect(parseArcgisQuery({ ...valid, returnGeometry: "maybe" })._tag).toBe(
      "Invalid",
    );
  });

  test("allows geometry=false and validates the GeoJSON collection shape", () => {
    expect(parseArcgisQuery({ ...valid, returnGeometry: "false" })).toEqual({
      _tag: "Valid",
      id: "123",
      returnGeometry: false,
    });
    expect(
      ArcgisFeatureCollectionSchema.pipe(Schema.decodeUnknownSync)({
        type: "FeatureCollection",
        features: [],
      }).features,
    ).toHaveLength(0);
  });
});

(runIntegration ? describe : describe.skip)("tile endpoint integration", () => {
  // Valid Sydney tile at zoom 14 – the service must return valid MVT within
  // the configured 10 s timeout (the test guard is more generous so CI doesn't
  // flake on a cold DB).
  test("returns a valid MVT tile without hanging", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CadastreService;
        const tile = yield* svc.getTile({ z: 14, x: 15073, y: 9833 });
        // Must be a non-empty Uint8Array (MVT binary).
        expect(tile).toBeInstanceOf(Uint8Array);
        expect(tile.byteLength).toBeGreaterThan(0);
        // Round-trip through the response schema to confirm the shape.
        Schema.decodeUnknownSync(TileResponseSchema)(tile);
        return tile;
      }).pipe(
        Effect.provide(
          Layer.effect(CadastreService)(CadastreService.make).pipe(
            Layer.provide(DbLive),
          ),
        ),
        // Guard: if the DB query hangs forever, fail the test.
        Effect.timeout("15 seconds"),
      ),
    );
  }, 20_000); // Bun test timeout slightly above the Effect guard.

  test("returns empty MVT for a tile with no matching lots", async () => {
    const tile = await Effect.runPromise(
      Effect.gen(function* () {
        const svc = yield* CadastreService;
        // Ocean tile far from any cadastre geometry.
        return yield* svc.getTile({ z: 14, x: 0, y: 0 });
      }).pipe(
        Effect.provide(
          Layer.effect(CadastreService)(CadastreService.make).pipe(
            Layer.provide(DbLive),
          ),
        ),
        Effect.timeout("10 seconds"),
      ),
    );
    // ST_AsMVT with no rows returns an empty bytea; the service coerces
    // null / empty to a zero-length Uint8Array.
    expect(tile).toBeInstanceOf(Uint8Array);
    expect(tile.byteLength).toBe(0);
  }, 15_000);
});
