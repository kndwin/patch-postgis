import { describe, expect, test } from "bun:test";
import {
  existingPmtilesFromHead,
  safePgArgs,
  tippecanoeArgs,
  tippecanoeSpawnOptions,
} from "./build-pmtiles.activity";

const runHash = "a".repeat(64);
const checksum = "b".repeat(64);
const completedHeaders = () =>
  new Headers({
    "content-length": "123",
    "x-expected-size": "123",
    "x-run-hash": runHash,
    "x-content-sha256": checksum,
    etag: '"completed-etag"',
  });

describe("PMTiles build commands", () => {
  test("reuses only a completed object with all owned metadata", () => {
    expect(existingPmtilesFromHead({ status: 404, headers: new Headers() }, runHash)).toEqual({
      kind: "missing",
    });
    expect(existingPmtilesFromHead({ status: 200, headers: completedHeaders() }, runHash)).toEqual({
      kind: "complete",
      size: 123,
      etag: "completed-etag",
      checksum,
    });
  });

  test("fails closed for conflicting completed-object response headers", () => {
    const ownedHeaders = [
      "content-length",
      "x-expected-size",
      "x-run-hash",
      "x-content-sha256",
      "etag",
    ];
    for (const name of ownedHeaders) {
      const headers = completedHeaders();
      headers.delete(name);
      expect(existingPmtilesFromHead({ status: 200, headers }, runHash)).toEqual({
        kind: "conflict",
      });
    }
    const unsafe = completedHeaders();
    unsafe.set("content-length", String(Number.MAX_SAFE_INTEGER + 1));
    unsafe.set("x-expected-size", String(Number.MAX_SAFE_INTEGER + 1));
    expect(existingPmtilesFromHead({ status: 200, headers: unsafe }, runHash)).toEqual({
      kind: "conflict",
    });
    expect(existingPmtilesFromHead({ status: 503, headers: new Headers() }, runHash)).toEqual({
      kind: "conflict",
    });
  });

  test("streams GeoJSONSeq through process stdin with production tile options", () => {
    const args = tippecanoeArgs("/work/lots.mbtiles", "/work/tmp");
    expect(args.at(-1)).toBe("-f");
    expect(args).not.toContain("/dev/stdin");
    expect(args).toContain("--no-feature-limit");
    expect(args).toContain("--no-tile-size-limit");
    expect(args).toContain("--detect-shared-borders");
    expect(args).toContain("--no-simplification-of-shared-nodes");
    expect(args).toContain("--temporary-directory=/work/tmp");

    const stdin = new ReadableStream<Uint8Array>();
    expect(tippecanoeSpawnOptions(stdin).stdin).toBe(stdin);
  });

  test("exports only browser-required fields without putting the password in argv", () => {
    const args = safePgArgs("postgres://user:s%20ecret@db.example/cadastre");
    expect(args.join(" ")).toContain(
      "SELECT id, lot_number, ST_Force2D(geometry) AS geometry FROM cadastre_lots",
    );
    expect(args.join(" ")).not.toContain("s ecret");
    expect(args.join(" ")).not.toContain("password=");
  });
});
