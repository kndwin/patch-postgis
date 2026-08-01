const CACHE_CONTROL = "public, max-age=31536000, immutable";
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
    headers.set("content-range", `bytes ${object.range.offset}-${end}/${object.size}`);
    headers.set("content-length", String(object.range.length));
  } else {
    headers.set("content-length", String(object.size));
  }
  return headers;
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

    const key = new URL(request.url).pathname.slice(1);
    if (!key.endsWith(".pmtiles") || key.includes("..")) {
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
