/// <reference types="@cloudflare/workers-types" />

import { Effect, Option } from "effect";
import { R2, Worker, WorkerEnvironment } from "effect-cf";
import { isPublishObjectKey, isSha256, normalizeEtag } from "../../cadastre/pmtiles.boundary";
export { isPublishObjectKey } from "../../cadastre/pmtiles.boundary";
import {
  LATEST_PATH,
  LATEST_POINTER_KEY,
  LATEST_PUBLISH_PATH,
  parseLatestManifest,
  type LatestManifest,
} from "./tiles.worker-boundary";
export { publishActionForRequest, routePublishRequest } from "./tiles.publish-routing";
import { publishActionForRequest, routePublishRequest } from "./tiles.publish-routing";

const Tiles = R2.make("Tiles");

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Range",
  "access-control-expose-headers":
    "Accept-Ranges, Content-Length, Content-Range, ETag, X-Content-Sha256",
  "access-control-max-age": "86400",
};

const CACHE_CONTROL = "public, max-age=31536000, immutable";
const PUBLISH_PATH = "/_publish";
const REDIRECT_CACHE_CONTROL = "no-store";

export const publishObjectKey = (request: Request): string | null => {
  try {
    const value = new URL(request.url).searchParams.get("objectKey");
    return isPublishObjectKey(value) ? value : null;
  } catch {
    return null;
  }
};
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
  if (result.some((part, index) => part.partNumber !== index + 1)) return null;
  return result;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const publishToken = (env: unknown) => {
  const value = (env as Record<string, unknown> | null)?.CADASTRE_TILE_PUBLISH_TOKEN;
  return typeof value === "string" && value.length > 0 ? value : null;
};
const authorized = (request: Request, env: unknown) => {
  const token = publishToken(env);
  return token !== null && request.headers.get("authorization") === `Bearer ${token}`;
};
const privateError = (status = 400) => json({ error: "Invalid publish request" }, status);
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

const publishHandler = Effect.fn("CadastreTilesWorker.publish")(function* (
  request: Request,
  env: Record<string, unknown>,
) {
  const key = publishObjectKey(request);
  if (key === null) return privateError();
  if (!authorized(request, env)) return privateError(401);
  const bucket = env.TILES as R2Bucket;
  if (request.method === "HEAD") {
    const object = yield* Effect.promise(() => bucket.head(key));
    if (!object) return privateError(404);
    const headers = new Headers({
      "content-type": "application/vnd.pmtiles",
      "content-length": String(object.size),
      etag: object.httpEtag,
      "x-expected-size": object.customMetadata?.expectedSize ?? "",
      "x-run-hash": object.customMetadata?.runHash ?? "",
      "x-content-sha256": object.customMetadata?.checksum ?? "",
    });
    return new Response(null, { headers });
  }
  const action = publishActionForRequest(request);
  const jsonAction =
    (request.method === "POST" && (action === "create" || action === "complete")) ||
    (request.method === "DELETE" && action === "abort");
  let body: Record<string, unknown> = {};
  if (jsonAction && request.method !== "DELETE") {
    try {
      const parsed = yield* Effect.promise(() => request.json());
      if (typeof parsed !== "object" || parsed === null) return privateError();
      body = parsed as Record<string, unknown>;
    } catch {
      return privateError();
    }
  }
  if (request.method === "POST" && action === "create") {
    const expectedSize = body.expectedSize;
    const runHash = body.runHash;
    const checksum = body.checksum;
    if (
      !Number.isSafeInteger(expectedSize) ||
      (expectedSize as number) <= 0 ||
      typeof runHash !== "string" ||
      keyRunHash(key) !== runHash ||
      typeof checksum !== "string" ||
      !/^[0-9a-f]{64}$/.test(runHash) ||
      !/^[0-9a-f]{64}$/.test(checksum)
    )
      return privateError();
    const existing = yield* Effect.promise(() => bucket.head(key));
    if (existing)
      return existing.size === expectedSize &&
        existing.customMetadata?.expectedSize === String(expectedSize) &&
        existing.customMetadata?.runHash === runHash &&
        existing.customMetadata?.checksum === checksum &&
        typeof existing.etag === "string" &&
        existing.etag.trim().replace(/^"|"$/g, "").length > 0
        ? json({
            objectKey: key,
            size: existing.size,
            etag: existing.etag,
            expectedSize: existing.customMetadata?.expectedSize,
            runHash: existing.customMetadata?.runHash,
            checksum: existing.customMetadata?.checksum,
          })
        : privateError(409);
    const upload = yield* Effect.promise(() =>
      bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: "application/vnd.pmtiles", cacheControl: CACHE_CONTROL },
        customMetadata: { expectedSize: String(expectedSize), runHash, checksum },
      }),
    );
    return json({ uploadId: upload.uploadId, expectedSize: String(expectedSize), runHash });
  }
  const uploadId =
    new URL(request.url).searchParams.get("uploadId") ??
    (typeof body.uploadId === "string" ? body.uploadId : request.headers.get("x-upload-id"));
  if (!uploadId) return privateError();
  const upload = bucket.resumeMultipartUpload(key, uploadId);
  if (routePublishRequest(request) === "part") {
    const partNumber = Number(
      new URL(request.url).searchParams.get("partNumber") ?? request.headers.get("x-part-number"),
    );
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !request.body)
      return privateError();
    const part = yield* Effect.promise(() => upload.uploadPart(partNumber, request.body!));
    return json({ partNumber, etag: part.etag });
  }
  if (request.method === "POST" && action === "complete") {
    const parts = parseMultipartParts(body.parts);
    if (!parts) return privateError();
    const expectedSize = body.expectedSize;
    const runHash = body.runHash;
    const checksum = body.checksum;
    if (
      !Number.isSafeInteger(expectedSize) ||
      (expectedSize as number) <= 0 ||
      typeof runHash !== "string" ||
      keyRunHash(key) !== runHash ||
      typeof checksum !== "string" ||
      !/^[0-9a-f]{64}$/.test(checksum)
    )
      return privateError(409);
    const expected = expectedSize as number;
    const completed = yield* Effect.promise(() => upload.complete(parts));
    const completedObject = yield* Effect.promise(() => bucket.head(key));
    if (
      !completedObject ||
      !validCompletionMetadata(
        completedObject.customMetadata,
        expected,
        runHash,
        checksum,
        completed.size,
      ) ||
      typeof completed.etag !== "string" ||
      completed.etag.trim().replace(/^"|"$/g, "").length === 0
    ) {
      yield* Effect.promise(() => bucket.delete(key));
      return privateError(409);
    }
    return json({
      objectKey: key,
      size: completed.size,
      rawEtag: completed.etag,
      expectedSize: String(expectedSize),
      runHash,
      checksum,
    });
  }
  if (request.method === "DELETE" && action === "abort") {
    yield* Effect.promise(() => upload.abort().catch(() => undefined));
    return new Response(null, { status: 204 });
  }
  return privateError();
});

const latestPublishHandler = Effect.fn("CadastreTilesWorker.publishLatest")(function* (
  request: Request,
  env: Record<string, unknown>,
) {
  if (request.method !== "PUT" && request.method !== "POST") return privateError(405);
  if (!authorized(request, env)) return privateError(401);
  let body: unknown;
  try {
    body = yield* Effect.promise(() => request.json());
  } catch {
    return privateError();
  }
  const input = body as Record<string, unknown> | null;
  if (
    !input ||
    !isPublishObjectKey(input.objectKey) ||
    !Number.isSafeInteger(input.size) ||
    (input.size as number) <= 0 ||
    !isSha256(input.checksum) ||
    typeof input.etag !== "string" ||
    normalizeEtag(input.etag) === null
  )
    return privateError();
  const bucket = env.TILES as R2Bucket;
  const object = yield* Effect.promise(() => bucket.head(input.objectKey as string));
  if (
    !object ||
    object.size !== input.size ||
    object.customMetadata?.checksum !== input.checksum ||
    normalizeEtag(object.httpEtag) !== normalizeEtag(input.etag as string)
  )
    return privateError(409);
  const manifest: LatestManifest = {
    version: 1,
    objectKey: input.objectKey as string,
    size: input.size as number,
    etag: input.etag as string,
    checksum: input.checksum as string,
  };
  yield* Effect.promise(() =>
    bucket.put(LATEST_POINTER_KEY, JSON.stringify(manifest), {
      httpMetadata: { contentType: "application/json", cacheControl: REDIRECT_CACHE_CONTROL },
    }),
  );
  return json({ published: true, objectKey: manifest.objectKey });
});

const latestRedirect = Effect.fn("CadastreTilesWorker.latestRedirect")(function* (
  request: Request,
  env: Record<string, unknown>,
) {
  const bucket = env.TILES as R2Bucket;
  const pointer = yield* Effect.promise(() => bucket.get(LATEST_POINTER_KEY));
  if (!pointer) return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  let manifest: LatestManifest | null = null;
  try {
    manifest = parseLatestManifest(yield* Effect.promise(() => pointer.json()));
  } catch {
    manifest = null;
  }
  if (!manifest) return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  const target = yield* Effect.promise(() => bucket.head(manifest!.objectKey));
  if (
    !target ||
    target.size !== manifest.size ||
    normalizeEtag(target.httpEtag) !== normalizeEtag(manifest.etag)
  )
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  const headers = new Headers(CORS_HEADERS);
  headers.set("location", new URL(`/${manifest.objectKey}`, request.url).toString());
  headers.set("cache-control", REDIRECT_CACHE_CONTROL);
  return new Response(null, { status: 307, headers });
});

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
  const env = yield* WorkerEnvironment;
  const pathname = new URL(request.url).pathname;
  if (pathname === LATEST_PUBLISH_PATH)
    return yield* latestPublishHandler(request, env as unknown as Record<string, unknown>).pipe(
      Effect.catchCause(() => Effect.succeed(privateError(500))),
    );
  if (pathname === PUBLISH_PATH)
    return yield* publishHandler(request, env as unknown as Record<string, unknown>).pipe(
      Effect.catchCause(() => Effect.succeed(privateError(500))),
    );
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, allow: "GET, HEAD, OPTIONS" },
    });
  }

  if (pathname === LATEST_PATH)
    return yield* latestRedirect(request, env as unknown as Record<string, unknown>).pipe(
      Effect.catchCause(() =>
        Effect.succeed(
          new Response("Internal Server Error", { status: 500, headers: CORS_HEADERS }),
        ),
      ),
    );

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
