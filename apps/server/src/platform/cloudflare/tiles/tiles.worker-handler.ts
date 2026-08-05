/// <reference types="@cloudflare/workers-types" />

import { Effect, Option } from "effect";
import { R2, Worker } from "effect-cf";

const Tiles = R2.make("Tiles");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range",
  "access-control-expose-headers": "Accept-Ranges, Content-Length, Content-Range, ETag",
  "access-control-max-age": "86400",
};

const CACHE_CONTROL = "public, max-age=31536000, immutable";

function archiveKey(pathname: string): string | null {
  try {
    const key = decodeURIComponent(pathname.replace(/^\//, ""));
    if (
      !key.endsWith(".pmtiles") ||
      !key ||
      key.includes("\\") ||
      key.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

function headersFor(object: R2Object, partial: boolean): Headers {
  const headers = new Headers(CORS_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", CACHE_CONTROL);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  const range = object.range;
  if (partial && range && "offset" in range && "length" in range) {
    const offset = range.offset;
    const length = range.length;
    if (offset !== undefined && length !== undefined) {
      headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    }
  }
  return headers;
}

const fetchHandler = Effect.fn("CadastreTilesWorker.fetch")(function* () {
  const request = yield* Worker.NativeRequest;
  const tiles = yield* Tiles;
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, allow: "GET, HEAD, OPTIONS" },
    });
  }

  const key = archiveKey(new URL(request.url).pathname);
  if (!key) return new Response("Not Found", { status: 404, headers: CORS_HEADERS });

  if (request.method === "HEAD") {
    const object = yield* tiles.head(key);
    return Option.isNone(object)
      ? new Response("Not Found", { status: 404, headers: CORS_HEADERS })
      : new Response(null, { headers: headersFor(object.value, false) });
  }

  const hasRange = request.headers.has("range");
  const object = yield* tiles.get(key, hasRange ? { range: request.headers } : undefined);
  if (Option.isNone(object)) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }
  return new Response(object.value.body, {
    status: hasRange ? 206 : 200,
    headers: headersFor(object.value, hasRange),
  });
});

export default Worker.make(Tiles.layer({ binding: "TILES" }), {
  fetch: fetchHandler(),
});
