import type { R2Object as CloudflareR2Object } from "@cloudflare/workers-types";
import { Effect } from "effect";
import { R2, Worker, WorkerEnvironment } from "effect-cf";
export {
  isSourceObjectKey,
  isValidChecksum,
  isValidPartSize,
  MAX_PART_SIZE,
  normalizeArtifactEtag,
  parseMultipartParts,
  isTrustedCadastreDownloadUrl,
  sourceHeaders,
  sourceObjectKeyFromRequest,
} from "./artifact.boundary";
import {
  isSourceObjectKey,
  isValidChecksum,
  isValidPartSize,
  parseMultipartParts,
  sourceHeaders,
} from "./artifact.boundary";

export const MAX_ARTIFACT_SIZE = 2 * 1024 * 1024 * 1024;
const Artifacts = R2.make("Artifacts");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bad = (status: number, message = "Invalid request") => json({ error: message }, status);
const metadataResponse = (objectKey: string, object: CloudflareR2Object) =>
  json({
    objectKey,
    size: object.size,
    etag: object.etag,
    ...(object.customMetadata?.checksum ? { checksum: object.customMetadata.checksum } : {}),
  });

const artifactToken = (env: unknown): string | null => {
  const token = (env as Record<string, unknown> | null)?.CADASTRE_ARTIFACT_TOKEN;
  return typeof token === "string" && token.length > 0 ? token : null;
};
const authorized = (request: Request, env: unknown) => {
  const token = artifactToken(env);
  return token !== null && request.headers.get("authorization") === `Bearer ${token}`;
};
const key = (request: Request) => {
  try {
    const value = new URL(request.url).searchParams.get("objectKey");
    return value !== null && isSourceObjectKey(value) ? value : null;
  } catch {
    return null;
  }
};
const action = (request: Request) => new URL(request.url).searchParams.get("action");
const uploadId = (request: Request) => new URL(request.url).searchParams.get("uploadId");
const fetchHandler = Effect.fn("CadastreArtifactWorker.fetch")(function* () {
  const request = yield* Worker.NativeRequest;
  if (new URL(request.url).pathname !== "/source") return bad(404, "Not Found");
  const env = yield* WorkerEnvironment;
  if (artifactToken(env) === null) return bad(503, "Service unavailable");
  if (!authorized(request, env)) return bad(401, "Unauthorized");
  const objectKey = key(request);
  if (objectKey === null) return bad(400);
  const bucket = (env as { ARTIFACTS: R2Bucket }).ARTIFACTS;

  if (request.method === "GET" || request.method === "HEAD") {
    const object = yield* Effect.promise(() => bucket.get(objectKey));
    if (!object) return bad(404, "Not Found");
    return request.method === "HEAD"
      ? new Response(null, { headers: sourceHeaders(object) })
      : new Response(object.body, { headers: sourceHeaders(object) });
  }

  const currentAction = action(request);
  if (currentAction === "part") {
    if (request.method !== "PUT" || !request.body) return bad(405, "Method Not Allowed");
    const id = uploadId(request);
    const number = Number(new URL(request.url).searchParams.get("partNumber"));
    const length = Number(request.headers.get("content-length"));
    if (
      !id ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > 10000 ||
      !isValidPartSize(length)
    )
      return bad(400);
    const body = request.body;
    if (!body) return bad(400);
    const upload = bucket.resumeMultipartUpload(objectKey, id);
    const result = yield* Effect.promise(() => upload.uploadPart(number, body));
    return json({ partNumber: number, etag: result.etag });
  }

  let body: Record<string, unknown> = {};
  if (currentAction === "create" || currentAction === "complete") {
    try {
      const parsed = yield* Effect.promise(() => request.json());
      if (typeof parsed !== "object" || parsed === null) return bad(400);
      body = parsed as Record<string, unknown>;
    } catch {
      return bad(400, "Invalid JSON");
    }
  }
  if (currentAction === "create" && request.method === "POST") {
    const existing = yield* Effect.promise(() => bucket.head(objectKey));
    const expectedSize = body.expectedSize;
    const checksum = body.checksum;
    if (
      !Number.isSafeInteger(expectedSize) ||
      (expectedSize as number) < 1 ||
      (expectedSize as number) > MAX_ARTIFACT_SIZE ||
      (checksum !== undefined && !isValidChecksum(checksum))
    )
      return bad(400);
    if (existing) {
      return existing.size === expectedSize &&
        (typeof checksum !== "string" || existing.customMetadata?.checksum === checksum)
        ? metadataResponse(objectKey, existing)
        : bad(409, "Object metadata mismatch");
    }
    const upload = yield* Effect.promise(() =>
      bucket.createMultipartUpload(objectKey, {
        httpMetadata: { contentType: "application/zip" },
        customMetadata: {
          expectedSize: String(expectedSize),
          ...(typeof checksum === "string" ? { checksum } : {}),
        },
      }),
    );
    return json({ uploadId: upload.uploadId, objectKey, expectedSize });
  }
  const id = uploadId(request);
  if (!id) return bad(400);
  const upload = bucket.resumeMultipartUpload(objectKey, id);
  if (currentAction === "complete" && request.method === "POST") {
    const list = parseMultipartParts(body.parts);
    const expectedSize = body.expectedSize;
    const checksum = body.checksum;
    if (
      !list ||
      !Number.isSafeInteger(expectedSize) ||
      (expectedSize as number) < 1 ||
      (expectedSize as number) > MAX_ARTIFACT_SIZE ||
      (checksum !== undefined && !isValidChecksum(checksum))
    )
      return bad(400);
    const winner = yield* Effect.promise(() => bucket.head(objectKey));
    if (winner)
      return winner.size === expectedSize &&
        (typeof checksum !== "string" || winner.customMetadata?.checksum === checksum)
        ? metadataResponse(objectKey, winner)
        : bad(409, "Object metadata mismatch");
    yield* Effect.promise(() => upload.complete(list));
    const object = yield* Effect.promise(() => bucket.head(objectKey));
    if (
      !object ||
      object.size !== expectedSize ||
      object.size > MAX_ARTIFACT_SIZE ||
      (typeof checksum === "string" && object.customMetadata?.checksum !== checksum)
    )
      return bad(409, "Multipart metadata mismatch");
    return metadataResponse(objectKey, object);
  }
  if (currentAction === "abort" && request.method === "DELETE") {
    yield* Effect.promise(() => upload.abort().catch(() => undefined));
    return new Response(null, { status: 204 });
  }
  return bad(405, "Method Not Allowed");
});

export default Worker.make(Artifacts.layer({ binding: "ARTIFACTS" }), { fetch: fetchHandler() });
