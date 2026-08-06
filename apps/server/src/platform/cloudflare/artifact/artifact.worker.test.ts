import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  isSourceObjectKey,
  isTrustedCadastreDownloadUrl,
  sourceHeaders,
  sourceObjectKeyFromRequest,
} from "./artifact.boundary";
import { sourceObjectKey } from "../../../module/cadastre/workflow/activity/download-gdb.activity";

describe("cadastre artifact boundary", () => {
  test("accepts only the provider export trust boundary", () => {
    expect(
      isTrustedCadastreDownloadUrl("https://portal.spatial.nsw.gov.au/exports/file.zip?sig=x"),
    ).toBe(true);
    expect(
      isTrustedCadastreDownloadUrl("https://portal.spatial.nsw.gov.au.evil/exports/file.zip"),
    ).toBe(false);
    expect(
      isTrustedCadastreDownloadUrl("https://portal.spatial.nsw.gov.au:444/exports/file.zip"),
    ).toBe(false);
  });

  test("accepts only hashed source keys", () => {
    expect(isSourceObjectKey(`runs/${"a".repeat(64)}/source/export.zip`)).toBe(true);
    expect(isSourceObjectKey(`runs/${"A".repeat(64)}/source/export.zip`)).toBe(false);
    expect(isSourceObjectKey(`runs/${"a".repeat(63)}/source/export.zip`)).toBe(false);
  });

  test("derives deterministic distinct source keys", async () => {
    const url = "https://portal.spatial.nsw.gov.au/exports/a.zip";
    const first = await Effect.runPromise(sourceObjectKey("run-1", url));
    const repeat = await Effect.runPromise(sourceObjectKey("run-1", url));
    const different = await Effect.runPromise(sourceObjectKey("run-2", url));
    expect(first).toBe(repeat);
    expect(different).not.toBe(first);
    expect(first).toMatch(/^runs\/[0-9a-f]{64}\/source\/export\.zip$/);
  });

  test("decodes and validates source retrieval keys", () => {
    const key = `runs/${"a".repeat(64)}/source/export.zip`;
    expect(
      sourceObjectKeyFromRequest(
        new Request(`https://artifact.test/source?objectKey=${encodeURIComponent(key)}`),
      ),
    ).toBe(key);
    expect(
      sourceObjectKeyFromRequest(new Request("https://artifact.test/source?objectKey=bad")),
    ).toBeNull();
  });

  test("builds streaming retrieval headers from R2 metadata", () => {
    const headers = sourceHeaders({
      size: 12,
      httpEtag: '"abc"',
      writeHttpMetadata: (target: Headers) => target.set("content-type", "application/zip"),
    });
    expect(headers.get("content-type")).toBe("application/zip");
    expect(headers.get("content-length")).toBe("12");
    expect(headers.get("etag")).toBe('"abc"');
    expect(headers.get("accept-ranges")).toBe("bytes");
  });
});
