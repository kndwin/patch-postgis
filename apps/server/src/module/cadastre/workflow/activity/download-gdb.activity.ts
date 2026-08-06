import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Config, Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
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
type ArtifactResult = { objectKey: string; size: number; etag: string };
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
      return { objectKey, size: result.size, etag: result.etag } satisfies ArtifactResult;
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
  if (valid(created, objectKey) && created.size === size) return created;
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
    return { objectKey: result.objectKey, size: result.size, etag: result.etag };
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

const download = async (url: string, file: string, expectedSize: number) => {
  if (!isTrustedCadastreDownloadUrl(url)) throw new Error("Untrusted provider URL");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  const contentLength = Number(response.headers.get("content-length"));
  if (
    !response.ok ||
    !response.body ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > MAX_ARTIFACT_SIZE ||
    contentLength !== expectedSize
  )
    throw new Error("Provider download failed");
  const writer = Bun.file(file).writer();
  for await (const chunk of response.body) await writer.write(chunk);
  await writer.end();
  const actual = (await stat(file)).size;
  if (actual !== contentLength) throw new Error("Provider download size mismatch");
  const hash = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return { size: actual, checksum: hash.digest("hex") };
};

export const DownloadGdbActivity = (input: DownloadGdbInput) =>
  Activity.make({
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
        return yield* Effect.tryPromise(async () => {
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
                return { objectKey, size: found.size, etag: found.etag };
              throw new Error("Invalid existing artifact metadata");
            }
            if (head.status !== 404) throw new Error("Artifact HEAD failed");
            const file = join(dir, "export.zip");
            const contentLength = await fetch(input.downloadUrl, {
              method: "HEAD",
              redirect: "error",
              signal: AbortSignal.timeout(60 * 1000),
            });
            const expected = Number(contentLength.headers.get("content-length"));
            const downloaded = await download(input.downloadUrl, file, expected);
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
          Effect.mapError(
            () => new CadastreWorkflowJsonError({ message: "Artifact transfer failed" }),
          ),
        );
      })(),
    ),
  });
