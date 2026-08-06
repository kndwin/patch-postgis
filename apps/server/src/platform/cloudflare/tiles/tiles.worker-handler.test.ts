import { describe, expect, test } from "bun:test";
import {
  headersFor,
  keyRunHash,
  parseMultipartParts,
  validCompletionMetadata,
} from "./tiles.worker-boundary";
import { routePublishRequest } from "./tiles.publish-routing";

const hash = "a".repeat(64);
const object = (partial = false) =>
  ({
    size: 100,
    httpEtag: '"etag"',
    range: partial ? { offset: 10, length: 20 } : undefined,
    customMetadata: { checksum: "b".repeat(64) },
    writeHttpMetadata: (headers: Headers) => headers.set("content-type", "application/vnd.pmtiles"),
  }) as unknown as R2Object;

describe("tile publish routing", () => {
  test("matches publish keys to their run hash and validates completion metadata", () => {
    const key = `runs/${hash}/tiles/lots.pmtiles`;
    expect(keyRunHash(key)).toBe(hash);
    expect(keyRunHash("runs/not-a-hash/tiles/lots.pmtiles")).toBeNull();
    expect(
      validCompletionMetadata(
        { expectedSize: "100", runHash: hash, checksum: "c" },
        100,
        hash,
        "c",
        100,
      ),
    ).toBe(true);
    expect(
      validCompletionMetadata(
        { expectedSize: "99", runHash: hash, checksum: "c" },
        100,
        hash,
        "c",
        100,
      ),
    ).toBe(false);
  });

  test("requires contiguous multipart part numbers", () => {
    expect(
      parseMultipartParts([
        { partNumber: 2, etag: "b" },
        { partNumber: 1, etag: "a" },
      ]),
    ).toEqual([
      { partNumber: 1, etag: "a" },
      { partNumber: 2, etag: "b" },
    ]);
    expect(
      parseMultipartParts([
        { partNumber: 1, etag: "a" },
        { partNumber: 3, etag: "c" },
      ]),
    ).toBeNull();
    expect(
      parseMultipartParts([
        { partNumber: 1, etag: "a" },
        { partNumber: 1, etag: "b" },
      ]),
    ).toBeNull();
  });

  test("builds complete and partial public range headers", () => {
    const full = headersFor(object(), false);
    expect(full.get("content-length")).toBe("100");
    expect(full.get("content-range")).toBeNull();
    expect(full.get("accept-ranges")).toBe("bytes");
    expect(full.get("x-content-sha256")).toBe("b".repeat(64));
    const partial = headersFor(object(true), true);
    expect(partial.get("content-length")).toBe("20");
    expect(partial.get("content-range")).toBe("bytes 10-29/100");
  });

  test("routes a binary part without decoding its body as JSON", () => {
    const request = new Request(
      "https://tiles.example/_publish?objectKey=runs/" +
        "a".repeat(64) +
        "/tiles/lots.pmtiles&action=part&partNumber=1",
      { method: "PUT", body: new Uint8Array([0, 1, 2, 255]) },
    );
    expect(routePublishRequest(request)).toBe("part");
  });

  test("rejects action and method mismatches", () => {
    expect(
      routePublishRequest(new Request("https://x/_publish?action=create", { method: "POST" })),
    ).toBe("create");
    expect(
      routePublishRequest(new Request("https://x/_publish?action=part", { method: "POST" })),
    ).toBeNull();
  });
});
