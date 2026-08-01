import { PMTiles } from "pmtiles";

const CACHE_CONTROL = "public, max-age=31536000, immutable";
const MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range",
  "access-control-expose-headers":
    "Accept-Ranges, Content-Length, Content-Range, ETag",
  "access-control-max-age": "86400",
};

function responseHeaders(object, isPartial = false) {
  const headers = new Headers(CORS_HEADERS);
  object.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", CACHE_CONTROL);
  headers.set("etag", object.httpEtag);

  if (isPartial) {
    const end = object.range.offset + object.range.length - 1;
    headers.set(
      "content-range",
      `bytes ${object.range.offset}-${end}/${object.size}`,
    );
    headers.set("content-length", String(object.range.length));
  } else {
    headers.set("content-length", String(object.size));
  }
  return headers;
}

function tileResponseHeaders() {
  return new Headers({
    ...CORS_HEADERS,
    "cache-control": CACHE_CONTROL,
    "content-type": MVT_CONTENT_TYPE,
  });
}

function archiveKey(value) {
  try {
    const key = decodeURIComponent(value);
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

function tilePath(pathname) {
  const match = pathname.match(/^\/(.+\.pmtiles)\/(\d+)\/(\d+)\/(\d+)\.mvt$/);
  if (!match) return undefined;
  const key = archiveKey(match[1]);
  const z = Number(match[2]);
  const x = Number(match[3]);
  const y = Number(match[4]);
  if (
    !key ||
    !Number.isSafeInteger(z) ||
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    z < 0 ||
    z > 26 ||
    x < 0 ||
    y < 0 ||
    x >= 2 ** z ||
    y >= 2 ** z
  ) {
    return { invalid: true };
  }
  return { key, z, x, y };
}

class R2Source {
  constructor(bucket, key) {
    this.bucket = bucket;
    this.key = key;
  }

  getKey() {
    return this.key;
  }

  async getBytes(offset, length) {
    const object = await this.bucket.get(this.key, {
      range: { offset, length },
    });
    if (!object) throw new Error("Archive not found");
    return { data: await object.arrayBuffer(), etag: object.httpEtag };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { ...CORS_HEADERS, allow: "GET, HEAD, OPTIONS" },
      });
    }

    const pathname = new URL(request.url).pathname;
    const tile = tilePath(pathname);
    if (request.method === "GET" && tile?.invalid) {
      return new Response("Bad Request", {
        status: 400,
        headers: CORS_HEADERS,
      });
    }
    if (request.method === "GET" && tile) {
      const object = await env.TILES.head(tile.key);
      if (!object)
        return new Response("Not Found", {
          status: 404,
          headers: CORS_HEADERS,
        });

      try {
        const response = await new PMTiles(
          new R2Source(env.TILES, tile.key),
        ).getZxy(tile.z, tile.x, tile.y);
        if (!response)
          return new Response("Not Found", {
            status: 404,
            headers: CORS_HEADERS,
          });
        const headers = tileResponseHeaders();
        headers.set("content-length", String(response.data.byteLength));
        return new Response(response.data, { status: 200, headers });
      } catch {
        return new Response("Bad Gateway", {
          status: 502,
          headers: CORS_HEADERS,
        });
      }
    }

    const key = archiveKey(pathname.slice(1));
    if (!key) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }

    if (request.method === "HEAD") {
      const object = await env.TILES.head(key);
      return object
        ? new Response(null, { headers: responseHeaders(object) })
        : new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }

    const requestedRange = request.headers.has("range");
    let object;
    try {
      // Passing the incoming headers lets R2 parse valid single byte ranges.
      // Do not pass Range when absent: R2 otherwise reports a whole-object
      // range, which must still be an HTTP 200 response.
      object = requestedRange
        ? await env.TILES.get(key, { range: request.headers })
        : await env.TILES.get(key);
    } catch {
      const metadata = await env.TILES.head(key);
      return metadata
        ? new Response(null, {
            status: 416,
            headers: {
              ...CORS_HEADERS,
              "content-range": `bytes */${metadata.size}`,
            },
          })
        : new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    if (!object) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    return new Response(object.body, {
      status: requestedRange ? 206 : 200,
      headers: responseHeaders(object, requestedRange),
    });
  },
};
