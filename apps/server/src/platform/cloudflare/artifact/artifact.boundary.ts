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

export const sourceObjectKeyFromRequest = (request: Request): string | null => {
  try {
    const objectKey = new URL(request.url).searchParams.get("objectKey");
    return objectKey !== null && isSourceObjectKey(objectKey) ? objectKey : null;
  } catch {
    return null;
  }
};

export const sourceHeaders = (object: unknown): Headers => {
  const value = object as Pick<CloudflareR2Object, "size" | "httpEtag" | "writeHttpMetadata">;
  const headers = new Headers();
  value.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/zip");
  headers.set("content-length", String(value.size));
  headers.set("etag", value.httpEtag);
  headers.set("accept-ranges", "bytes");
  return headers;
};
import type { R2Object as CloudflareR2Object } from "@cloudflare/workers-types";
