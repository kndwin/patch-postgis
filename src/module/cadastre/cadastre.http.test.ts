import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { LotResponseSchema } from "./cadastre.http.schema";

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
