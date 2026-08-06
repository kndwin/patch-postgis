import type { R2Object as CloudflareR2Object } from "@cloudflare/workers-types";
import { Effect, Option } from "effect";
import { R2, Worker, WorkerEnvironment } from "effect-cf";
export {
  isSourceObjectKey,
  isTrustedCadastreDownloadUrl,
  sourceHeaders,
  sourceObjectKeyFromRequest,
} from "./artifact.boundary";
import {
  isSourceObjectKey,
  isTrustedCadastreDownloadUrl,
  sourceHeaders,
  sourceObjectKeyFromRequest,
} from "./artifact.boundary";

export const MAX_ARTIFACT_SIZE = 2 * 1024 * 1024 * 1024;
class ArtifactTooLargeError extends Error {}
const artifactTooLarge = new ArtifactTooLargeError("artifact too large");
const Artifacts = R2.make("Artifacts");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bad = (status: number, message: string) => json({ error: message }, status);
const metadataResponse = (objectKey: string, object: CloudflareR2Object) =>
  json({ objectKey, size: object.size, etag: object.etag });

const sourcePath = (request: Request): boolean => {
  try {
    return new URL(request.url).pathname === "/source";
  } catch {
    return false;
  }
};

const artifactToken = (env: unknown): string | null => {
  const token = (env as Record<string, unknown> | null)?.CADASTRE_ARTIFACT_TOKEN;
  return typeof token === "string" && token.length > 0 ? token : null;
};

const authorized = (request: Request, env: unknown): boolean => {
  const token = artifactToken(env);
  return token !== null && request.headers.get("authorization") === `Bearer ${token}`;
};

export const countingStream = (
  body: ReadableStream<Uint8Array>,
  onCount: (size: number) => void,
) => {
  let size = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MAX_ARTIFACT_SIZE) {
          controller.error(artifactTooLarge);
          return;
        }
        onCount(size);
        controller.enqueue(chunk);
      },
    }),
  );
};

const fetchHandler = Effect.fn("CadastreArtifactWorker.fetch")(function* () {
  const request = yield* Worker.NativeRequest;
  const bucket = yield* Artifacts;
  if (request.method !== "POST" && request.method !== "GET") return bad(405, "Method Not Allowed");
  if (!sourcePath(request)) return bad(404, "Not Found");
  const env = yield* WorkerEnvironment;
  if (artifactToken(env) === null) return bad(503, "Service unavailable");
  if (!authorized(request, env)) return bad(401, "Unauthorized");
  if (request.method === "GET") {
    const objectKey = sourceObjectKeyFromRequest(request);
    if (objectKey === null) return bad(400, "Invalid request");
    const result = yield* bucket.get(objectKey).pipe(Effect.catchCause(() => Effect.succeed(null)));
    if (result === null) return bad(503, "Storage unavailable");
    if (Option.isNone(result)) return bad(404, "Not Found");
    return new Response(result.value.body, { headers: sourceHeaders(result.value) });
  }
  let input: unknown;
  try {
    input = yield* Effect.tryPromise(() => request.json());
  } catch {
    return bad(400, "Invalid JSON");
  }
  const record = typeof input === "object" && input !== null ? input : null;
  const downloadUrl = record && "downloadUrl" in record ? record.downloadUrl : undefined;
  const objectKey = record && "objectKey" in record ? record.objectKey : undefined;
  if (
    typeof downloadUrl !== "string" ||
    typeof objectKey !== "string" ||
    !isTrustedCadastreDownloadUrl(downloadUrl) ||
    !isSourceObjectKey(objectKey)
  )
    return bad(400, "Invalid request");
  const existing = yield* bucket
    .head(objectKey)
    .pipe(Effect.catchCause(() => Effect.succeed(bad(503, "Storage unavailable"))));
  if (existing instanceof Response) return existing;
  if (Option.isSome(existing)) return metadataResponse(objectKey, existing.value);
  const upstream = yield* Effect.tryPromise(() => fetch(downloadUrl, { redirect: "error" })).pipe(
    Effect.catchCause(() => Effect.succeed(null)),
  );
  if (upstream === null) return bad(502, "Upstream download failed");
  if (!upstream.ok || !upstream.body) return bad(502, "Upstream download failed");
  const contentLengthHeader = upstream.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null) {
    if (contentLengthHeader?.trim() === "" || !Number.isFinite(contentLength) || contentLength < 0)
      return bad(502, "Upstream download failed");
  }
  if (contentLength !== null && contentLength > MAX_ARTIFACT_SIZE)
    return bad(413, "Artifact too large");
  let size = 0;
  const result = yield* bucket
    .put(
      objectKey,
      countingStream(upstream.body, (n) => {
        size = n;
      }),
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/zip" },
      },
    )
    .pipe(
      Effect.catchCause((error) =>
        Effect.succeed(
          bad(
            isArtifactTooLargeError(error) ? 413 : 503,
            isArtifactTooLargeError(error) ? "Artifact too large" : "Storage unavailable",
          ),
        ),
      ),
    );
  if (result instanceof Response) return result;
  if (Option.isNone(result)) {
    const winner = yield* bucket
      .head(objectKey)
      .pipe(Effect.catchCause(() => Effect.succeed(bad(503, "Storage unavailable"))));
    if (winner instanceof Response) return winner;
    return Option.isSome(winner)
      ? metadataResponse(objectKey, winner.value)
      : bad(503, "Storage unavailable");
  }
  const uploaded = result.value;
  if (
    typeof uploaded !== "object" ||
    uploaded === null ||
    !("size" in uploaded) ||
    !("etag" in uploaded) ||
    typeof uploaded.size !== "number" ||
    typeof uploaded.etag !== "string"
  )
    return bad(503, "Storage unavailable");
  if (contentLength !== null && size !== contentLength) return bad(502, "Upstream download failed");
  if (uploaded.size !== size) return bad(502, "Upstream download failed");
  return metadataResponse(objectKey, uploaded);
});

const isArtifactTooLargeError = (error: unknown): boolean => {
  if (error === artifactTooLarge) return true;
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    for (const key of ["error", "cause", "defect"] as const) {
      if (key in record && isArtifactTooLargeError(record[key])) return true;
    }
  }
  return false;
};

export default Worker.make(Artifacts.layer({ binding: "ARTIFACTS" }), { fetch: fetchHandler() });
