/// <reference types="@cloudflare/workers-types" />

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range",
  "access-control-expose-headers":
    "Accept-Ranges, Content-Length, Content-Range, ETag, X-Content-Sha256",
  "access-control-max-age": "86400",
};
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export const parseMultipartParts = (
  value: unknown,
): { partNumber: number; etag: string }[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const result: { partNumber: number; etag: string }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const record = item as Record<string, unknown>;
    if (
      !Number.isInteger(record.partNumber) ||
      (record.partNumber as number) < 1 ||
      (record.partNumber as number) > 10000 ||
      typeof record.etag !== "string" ||
      record.etag.length === 0
    )
      return null;
    result.push({ partNumber: record.partNumber as number, etag: record.etag });
  }
  result.sort((a, b) => a.partNumber - b.partNumber);
  return result.some((part, index) => part.partNumber !== index + 1) ? null : result;
};

export const keyRunHash = (key: string): string | null =>
  key.match(/^runs\/([0-9a-f]{64})\/tiles\/lots\.pmtiles$/)?.[1] ?? null;
export const validCompletionMetadata = (
  metadata: Record<string, string> | undefined,
  expectedSize: number,
  runHash: string,
  checksum: string,
  size: number,
) =>
  size === expectedSize &&
  metadata?.expectedSize === String(expectedSize) &&
  metadata.runHash === runHash &&
  metadata.checksum === checksum;

export function headersFor(object: R2Object, partial: boolean): Headers {
  const headers = new Headers(CORS_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("content-type", "application/vnd.pmtiles");
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", CACHE_CONTROL);
  headers.set("etag", object.httpEtag);
  headers.set("x-content-sha256", object.customMetadata?.checksum ?? "");
  headers.set(
    "content-length",
    String(partial && object.range && "length" in object.range ? object.range.length : object.size),
  );
  const range = object.range;
  if (
    partial &&
    range &&
    "offset" in range &&
    "length" in range &&
    range.offset !== undefined &&
    range.length !== undefined
  )
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
  return headers;
}
