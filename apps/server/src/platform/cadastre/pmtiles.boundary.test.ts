import { describe, expect, test } from "bun:test";
import {
  encodedPublicTileUrl,
  isPublishObjectKey,
  isSha256,
  normalizeEtag,
  normalizeTileBaseUrl,
  validPmtilesHeader,
  validPmtilesHeaderJson,
  validPmtilesMetadataJson,
} from "./pmtiles.boundary";

const runHash = "a".repeat(64);
const headerJson = JSON.stringify({ tile_type: "mvt", minzoom: 14, maxzoom: 18 });
const metadataJson = JSON.stringify({
  format: "pbf",
  minzoom: "14",
  maxzoom: "18",
  vector_layers: [{ id: "lots", fields: { id: "String", lot_number: "String" } }],
});

describe("PMTiles boundary contract", () => {
  test("accepts the checked-in go-pmtiles header and metadata shapes", () => {
    expect(validPmtilesHeaderJson(headerJson)).toBe(true);
    expect(validPmtilesMetadataJson(metadataJson)).toBe(true);
    expect(validPmtilesMetadataJson(metadataJson.replace('"18"', "18"))).toBe(false);
  });

  test("requires a complete PMTiles v3 127-byte header", () => {
    const bytes = new Uint8Array(127);
    bytes.set(new TextEncoder().encode("pmtiles"));
    bytes[7] = 3;
    expect(validPmtilesHeader(bytes)).toBe(true);
    expect(validPmtilesHeader(bytes.slice(0, 126))).toBe(false);
    bytes[0] = 0;
    expect(validPmtilesHeader(bytes)).toBe(false);
    bytes[0] = "p".charCodeAt(0);
    bytes[7] = 2;
    expect(validPmtilesHeader(bytes)).toBe(false);
  });

  test("normalizes and validates keys, checksums, ETags, and public URLs", () => {
    const key = `runs/${runHash}/tiles/lots.pmtiles`;
    expect(isPublishObjectKey(key)).toBe(true);
    expect(isPublishObjectKey(`runs/${runHash.toUpperCase()}/tiles/lots.pmtiles`)).toBe(false);
    expect(isSha256("f".repeat(64))).toBe(true);
    expect(isSha256("f".repeat(63))).toBe(false);
    expect(normalizeEtag('  "abc"  ')).toBe("abc");
    expect(normalizeEtag('""')).toBeNull();
    expect(normalizeTileBaseUrl("https://tiles.example/")).toBe("https://tiles.example");
    expect(normalizeTileBaseUrl("https://tiles.example/path")).toBeNull();
    expect(normalizeTileBaseUrl("https://tiles.example/?stage=prod")).toBeNull();
    expect(normalizeTileBaseUrl("https://user:pass@tiles.example")).toBeNull();
    expect(normalizeTileBaseUrl("file:///tmp/tiles")).toBeNull();
    expect(encodedPublicTileUrl("https://tiles.example/", key)).toBe(
      `https://tiles.example/runs/${runHash}/tiles/lots.pmtiles`,
    );
    expect(encodedPublicTileUrl("https://tiles.example", "runs/a b/tiles/lots.pmtiles")).toBe(
      "https://tiles.example/runs/a%20b/tiles/lots.pmtiles",
    );
  });
});
