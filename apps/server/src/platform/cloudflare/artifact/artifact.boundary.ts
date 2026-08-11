export const isTrustedCadastreDownloadUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "portal.spatial.nsw.gov.au" &&
      !url.port &&
      !url.username &&
      !url.password &&
      url.pathname.startsWith("/exports/") &&
      url.pathname.toLowerCase().endsWith(".zip")
    );
  } catch {
    return false;
  }
};

export const isSourceObjectKey = (value: string): boolean =>
  /^runs\/[0-9a-f]{64}\/source\/export\.zip$/.test(value);

export const normalizeArtifactEtag = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  let etag = value.trim();
  if (etag.startsWith("W/")) etag = etag.slice(2);
  else if (/^w\//i.test(etag)) return null;
  if (etag.startsWith('"') || etag.endsWith('"')) {
    if (!(etag.startsWith('"') && etag.endsWith('"'))) return null;
    etag = etag.slice(1, -1);
  }
  return etag !== "" && /^[^\s"]+$/.test(etag) ? etag : null;
};

export const MAX_PART_SIZE = 64 * 1024 * 1024;
export const isValidChecksum = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
export const isValidPartSize = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_PART_SIZE;
export const parseMultipartParts = (
  value: unknown,
): { partNumber: number; etag: string }[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10000) return null;
  const result: { partNumber: number; etag: string }[] = [];
  for (const part of value) {
    if (typeof part !== "object" || part === null) return null;
    const record = part as Record<string, unknown>;
    if (
      !Number.isSafeInteger(record.partNumber) ||
      typeof record.etag !== "string" ||
      record.etag.trim() === ""
    )
      return null;
    result.push({ partNumber: record.partNumber as number, etag: record.etag });
  }
  result.sort((a, b) => a.partNumber - b.partNumber);
  return result.every((part, index) => part.partNumber === index + 1) ? result : null;
};

export const sourceObjectKeyFromRequest = (request: Request): string | null => {
  try {
    const objectKey = new URL(request.url).searchParams.get("objectKey");
    return objectKey !== null && isSourceObjectKey(objectKey) ? objectKey : null;
  } catch {
    return null;
  }
};

export const sourceHeaders = (object: unknown): Headers => {
  const value = object as Pick<CloudflareR2Object, "size" | "httpEtag" | "writeHttpMetadata"> & {
    customMetadata?: Record<string, string>;
  };
  const headers = new Headers();
  value.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/zip");
  headers.set("content-length", String(value.size));
  headers.set("etag", value.httpEtag);
  if (value.customMetadata?.checksum)
    headers.set("x-content-sha256", value.customMetadata.checksum);
  headers.set("accept-ranges", "bytes");
  return headers;
};
import type { R2Object as CloudflareR2Object } from "@cloudflare/workers-types";
