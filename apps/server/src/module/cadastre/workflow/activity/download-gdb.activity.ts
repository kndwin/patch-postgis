import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { Config, DateTime, Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import { activityInterruptRetryPolicy } from "./activity-options.activity";
import { WorkflowEngine } from "effect/unstable/workflow";
import { WorkflowProjectionRepo } from "../cadastre-workflow.repo";
import { isTrustedCadastreDownloadUrl } from "../../../../platform/cloudflare/artifact/artifact.boundary";
import {
  CadastreActivityErrorSchema,
  DownloadGdbSuccessSchema,
  type DownloadGdbInput,
} from "./download-gdb.activity.schema";
import {
  CadastreWorkflowConfigError,
  CadastreWorkflowHttpError,
  CadastreWorkflowJsonError,
} from "./cadastre-workflow-error.schema";

export const PART_SIZE = 64 * 1024 * 1024;
export const MAX_ARTIFACT_SIZE = 2 * 1024 * 1024 * 1024;

export const sourceObjectKey = (idempotencyKey: string, downloadUrl: string) =>
  Effect.tryPromise(async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${idempotencyKey}\0${downloadUrl}`),
    );
    return `runs/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}/source/export.zip`;
  });

export type Metadata = { objectKey?: string; size?: number; etag?: string; checksum?: string };
type ArtifactResult = { objectKey: string; size: number; etag: string; checksum: string };
const metadata = (value: unknown): Metadata =>
  typeof value === "object" && value !== null ? (value as Metadata) : {};
const valid = (
  value: Metadata,
  objectKey: string,
): value is { objectKey: string; size: number; etag: string; checksum?: string } =>
  value.objectKey === objectKey &&
  Number.isSafeInteger(value.size) &&
  value.size !== undefined &&
  value.size > 0 &&
  value.size <= MAX_ARTIFACT_SIZE &&
  typeof value.etag === "string" &&
  value.etag.trim() !== "";

export const uploadSourceArtifact = async (
  artifactUrl: string,
  token: string,
  objectKey: string,
  file: string,
  size: number,
  checksum: string,
) => {
  const base = artifactUrl.replace(/\/$/, "");
  const auth = { authorization: `Bearer ${token}` };
  const existing = await fetch(`${base}/source?objectKey=${encodeURIComponent(objectKey)}`, {
    method: "HEAD",
    headers: auth,
  });
  if (existing.ok) {
    const result = {
      objectKey,
      size: Number(existing.headers.get("content-length")),
      etag: existing.headers.get("etag") ?? "",
      checksum: existing.headers.get("x-content-sha256") ?? "",
    };
    if (valid(result, objectKey) && result.size === size && result.checksum === checksum)
      return { objectKey, size: result.size, etag: result.etag, checksum } satisfies ArtifactResult;
    throw new Error("Invalid existing artifact metadata");
  }
  if (existing.status !== 404) throw new Error("Artifact HEAD failed");

  const create = await fetch(
    `${base}/source?objectKey=${encodeURIComponent(objectKey)}&action=create`,
    {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ expectedSize: size, checksum }),
    },
  );
  if (!create.ok) throw new Error("Artifact multipart session failed");
  const created = metadata(await create.json());
  if (valid(created, objectKey) && created.size === size)
    return { ...created, checksum: created.checksum ?? checksum };
  const id = (created as { uploadId?: unknown }).uploadId;
  if (typeof id !== "string" || id === "") throw new Error("Invalid multipart session");
  let complete = false;
  try {
    const uploaded: { partNumber: number; etag: string }[] = [];
    for (let offset = 0, partNumber = 1; offset < size; offset += PART_SIZE, partNumber += 1) {
      const bytes = await Bun.file(file)
        .slice(offset, Math.min(size, offset + PART_SIZE))
        .arrayBuffer();
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await fetch(
          `${base}/source?objectKey=${encodeURIComponent(objectKey)}&action=part&uploadId=${encodeURIComponent(id)}&partNumber=${partNumber}`,
          {
            method: "PUT",
            headers: { ...auth, "content-length": String(bytes.byteLength) },
            body: bytes,
          },
        );
        if (response.ok) break;
      }
      if (!response?.ok) throw new Error("Artifact multipart part failed");
      const part = metadata(await response.json());
      if (
        (part as { partNumber?: unknown }).partNumber !== partNumber ||
        typeof (part as { etag?: unknown }).etag !== "string"
      )
        throw new Error("Invalid multipart part response");
      uploaded.push({ partNumber, etag: (part as { etag: string }).etag });
    }
    const response = await fetch(
      `${base}/source?objectKey=${encodeURIComponent(objectKey)}&action=complete&uploadId=${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ parts: uploaded, expectedSize: size, checksum }),
      },
    );
    if (!response.ok) throw new Error("Artifact multipart completion failed");
    const result = metadata(await response.json());
    if (!valid(result, objectKey) || result.size !== size || result.checksum !== checksum)
      throw new Error("Invalid completed artifact metadata");
    complete = true;
    return {
      objectKey: result.objectKey,
      size: result.size,
      etag: result.etag,
      checksum: result.checksum ?? checksum,
    };
  } finally {
    if (!complete) {
      try {
        await fetch(
          `${base}/source?objectKey=${encodeURIComponent(objectKey)}&action=abort&uploadId=${encodeURIComponent(id)}`,
          { method: "DELETE", headers: auth },
        );
      } catch {
        /* preserve upload error */
      }
    }
  }
};

type DownloadFailureCategory = "validation" | "http" | "stream" | "fetch";
class DownloadFailure extends Error {
  constructor(
    readonly category: DownloadFailureCategory,
    readonly status?: number,
  ) {
    super("Provider download failed");
  }
}

const logTransferFailure = (error: unknown) => {
  if (error instanceof DownloadFailure) {
    const status = error.status === undefined ? "" : ` status=${error.status}`;
    return Effect.logError(
      `cadastre artifact transfer failed stage=provider-download category=${error.category}${status}`,
    );
  }
  return Effect.logError(
    "cadastre artifact transfer failed stage=artifact-transfer category=unknown",
  );
};

const retryDelay = (attempt: number) =>
  new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));

/** Downloads directly from the provider. The response, rather than a preflight HEAD, is authoritative. */
export const downloadProviderArtifact = async (url: string, file: string) => {
  if (!isTrustedCadastreDownloadUrl(url)) throw new DownloadFailure("validation");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rm(file, { force: true }).catch(() => undefined);
    let response: Response | undefined;
    let writer: { write: (chunk: Uint8Array) => unknown; end: () => unknown } | undefined;
    try {
      try {
        response = await fetch(url, {
          redirect: "error",
          signal: AbortSignal.timeout(15 * 60 * 1000),
        });
      } catch {
        throw new DownloadFailure("fetch");
      }
      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        await response.body?.cancel?.()?.catch(() => undefined);
        throw new DownloadFailure(retryable ? "http" : "validation", response.status);
      }
      const rawLength = response.headers.get("content-length");
      const declared = rawLength === null ? undefined : Number(rawLength);
      if (
        (declared !== undefined &&
          (!Number.isSafeInteger(declared) || declared < 1 || declared > MAX_ARTIFACT_SIZE)) ||
        !response.body
      )
        throw new DownloadFailure("validation", response.status);

      const currentWriter = Bun.file(file).writer();
      writer = currentWriter;
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_ARTIFACT_SIZE) throw new DownloadFailure("validation", response.status);
        await currentWriter.write(chunk);
      }
      await currentWriter.end();
      writer = undefined;
      if (size < 1) throw new DownloadFailure("validation", response.status);
      if (declared !== undefined && size !== declared)
        throw new DownloadFailure("stream", response.status);
      const hash = new Bun.CryptoHasher("sha256");
      for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
      return { size, checksum: hash.digest("hex") };
    } catch (error) {
      if (writer) {
        try {
          await writer.end();
        } catch {
          /* remove the partial file below */
        }
      }
      await response?.body?.cancel?.()?.catch(() => undefined);
      await rm(file, { force: true }).catch(() => undefined);
      const failure = error instanceof DownloadFailure ? error : new DownloadFailure("stream");
      if (failure.category !== "validation" && attempt < 2) {
        await retryDelay(attempt);
        continue;
      }
      throw failure;
    }
  }
  throw new DownloadFailure("fetch");
};

export const DownloadGdbActivity = (input: DownloadGdbInput) =>
  Activity.make({
    interruptRetryPolicy: activityInterruptRetryPolicy,
    name: "CadastreSyncWorkflow/download-gdb",
    error: CadastreActivityErrorSchema,
    success: DownloadGdbSuccessSchema,
    execute: projectActivity(
      "download-gdb",
      Effect.fn("CadastreSyncWorkflow.downloadGdb")(function* () {
        const url = yield* Config.string("CADASTRE_ARTIFACT_URL").pipe(
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "Artifact URL is not configured" }),
          ),
        );
        const token = yield* Config.string("CADASTRE_ARTIFACT_TOKEN").pipe(
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "Artifact token is not configured" }),
          ),
        );
        const work = yield* Config.string("CADASTRE_WORK_DIR").pipe(
          Config.withDefault("/tmp"),
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "Invalid work directory" }),
          ),
        );
        if (
          !isTrustedCadastreDownloadUrl(input.downloadUrl) ||
          url.trim() === "" ||
          token.trim() === ""
        )
          return yield* Effect.fail(
            new CadastreWorkflowConfigError({ message: "Artifact configuration is incomplete" }),
          );
        const objectKey = yield* sourceObjectKey(input.idempotencyKey, input.downloadUrl).pipe(
          Effect.mapError(
            () => new CadastreWorkflowHttpError({ message: "Unable to generate artifact key" }),
          ),
        );
        const result = yield* Effect.tryPromise(async () => {
          const dir = await mkdtemp(join(work, "gdb-"));
          try {
            const head = await fetch(
              `${url.replace(/\/$/, "")}/source?objectKey=${encodeURIComponent(objectKey)}`,
              { method: "HEAD", headers: { authorization: `Bearer ${token}` } },
            );
            if (head.ok) {
              const found = {
                objectKey,
                size: Number(head.headers.get("content-length")),
                etag: head.headers.get("etag") ?? "",
                checksum: head.headers.get("x-content-sha256") ?? "",
              };
              if (valid(found, objectKey) && /^[0-9a-f]{64}$/i.test(found.checksum))
                return { objectKey, size: found.size, etag: found.etag, checksum: found.checksum };
              throw new Error("Invalid existing artifact metadata");
            }
            if (head.status !== 404) throw new Error("Artifact HEAD failed");
            const file = join(dir, "export.zip");
            const downloaded = await downloadProviderArtifact(input.downloadUrl, file);
            return await uploadSourceArtifact(
              url,
              token,
              objectKey,
              file,
              downloaded.size,
              downloaded.checksum,
            );
          } finally {
            await rm(dir, { recursive: true, force: true }).catch(() => undefined);
          }
        }).pipe(
          Effect.tapError(logTransferFailure),
          Effect.mapError(
            () => new CadastreWorkflowJsonError({ message: "Artifact transfer failed" }),
          ),
        );
        const repo = yield* WorkflowProjectionRepo;
        const instance = yield* WorkflowEngine.WorkflowInstance;
        const createdAt = yield* DateTime.now;
        yield* repo
          .saveSourceArtifact({
            executionId: instance.executionId,
            ...result,
            createdAt: DateTime.toDate(createdAt),
          })
          .pipe(
            Effect.mapError(
              () =>
                new CadastreWorkflowJsonError({ message: "Artifact metadata persistence failed" }),
            ),
          );
        return result;
      })(),
    ),
  });
