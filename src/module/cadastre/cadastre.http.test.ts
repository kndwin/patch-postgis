import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  ArcgisFeatureCollectionSchema,
  LotResponseSchema,
  parseArcgisQuery,
} from "./cadastre.http.schema";

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
