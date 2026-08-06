import { Effect, Config } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import { and, eq } from "drizzle-orm";
import { Db } from "../../../../platform/database/client";
import {
  CadastreActivityErrorSchema,
  VerifyPublishInputSchema,
  VerifyPublishSuccessSchema,
} from "./verify-publish.activity.schema";
import { CadastreWorkflowConfigError } from "./cadastre-workflow-error.schema";
import {
  encodedPublicTileUrl,
  validPmtilesHeader,
  validPmtilesHeaderJson,
  validPmtilesMetadataJson,
  isPublishObjectKey,
  normalizeEtag,
  isSha256,
  normalizeTileBaseUrl,
} from "../../../../platform/cadastre/pmtiles.boundary";
import { cadastreSnapshots } from "../../sync/cadastre-sync.model";
import { CadastreWorkflowPmtilesError } from "./cadastre-workflow-error.schema";

const inspect = async (args: string[]) => {
  const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stdout =
    process.stdout && typeof process.stdout !== "number"
      ? new Response(process.stdout).text()
      : Promise.resolve("");
  const stderr =
    process.stderr && typeof process.stderr !== "number"
      ? (async () => {
          const reader = process.stderr!.getReader();
          while (!(await reader.read()).done) {}
        })()
      : Promise.resolve();
  const [code, text] = await Promise.all([process.exited, stdout, stderr]);
  if (code !== 0) throw new Error("PMTiles verification failed");
  return text;
};

export const VerifyPublishActivity = (input: typeof VerifyPublishInputSchema.Type) =>
  Activity.make({
    name: "CadastreSyncWorkflow/verify-publish",
    error: CadastreActivityErrorSchema,
    success: VerifyPublishSuccessSchema,
    execute: projectActivity(
      "verify-publish",
      Effect.fn("CadastreSyncWorkflow.verifyPublish.execute")(function* () {
        const base = yield* Config.string("CADASTRE_TILE_URL").pipe(
          Effect.mapError(
            () => new CadastreWorkflowConfigError({ message: "CADASTRE_TILE_URL is required" }),
          ),
        );
        if (!base.trim())
          return yield* new CadastreWorkflowConfigError({
            message: "CADASTRE_TILE_URL is required",
          });
        const normalizedBase = normalizeTileBaseUrl(base);
        if (!normalizedBase)
          return yield* new CadastreWorkflowConfigError({
            message: "CADASTRE_TILE_URL must be an HTTP(S) URL without credentials",
          });
        if (!isPublishObjectKey(input.objectKey))
          return yield* new CadastreWorkflowPmtilesError({ message: "Invalid tile object key" });
        const url = encodedPublicTileUrl(normalizedBase, input.objectKey);
        const head = yield* Effect.tryPromise(() => fetch(url, { method: "HEAD" })).pipe(
          Effect.mapError(
            () => new CadastreWorkflowPmtilesError({ message: "Public tile verification failed" }),
          ),
        );
        if (
          !head.ok ||
          head.headers.get("content-type") !== "application/vnd.pmtiles" ||
          head.headers.get("x-content-sha256") !== input.checksum ||
          !isSha256(input.checksum) ||
          Number(head.headers.get("content-length")) !== input.size ||
          normalizeEtag(head.headers.get("etag")) !== normalizeEtag(input.etag)
        )
          return yield* new CadastreWorkflowPmtilesError({
            message: "Public tile verification failed",
          });
        const range = yield* Effect.tryPromise(() =>
          fetch(url, { headers: { range: "bytes=0-126" } }),
        ).pipe(
          Effect.mapError(
            () => new CadastreWorkflowPmtilesError({ message: "Public tile verification failed" }),
          ),
        );
        const bytes = new Uint8Array(yield* Effect.promise(() => range.arrayBuffer()));
        if (
          bytes.byteLength !== 127 ||
          range.headers.get("content-length") !== "127" ||
          normalizeEtag(range.headers.get("etag")) !== normalizeEtag(input.etag) ||
          range.status !== 206 ||
          range.headers.get("content-type") !== "application/vnd.pmtiles" ||
          range.headers.get("accept-ranges") !== "bytes" ||
          !/^bytes 0-126\/[0-9]+$/.test(range.headers.get("content-range") ?? "") ||
          Number((range.headers.get("content-range") ?? "").split("/")[1]) !== input.size ||
          !validPmtilesHeader(bytes) ||
          range.headers.get("x-content-sha256") !== input.checksum
        )
          return yield* new CadastreWorkflowPmtilesError({
            message: "Public tile range is not a PMTiles v3 header",
          });
        const cliHeader = yield* Effect.tryPromise(() =>
          inspect(["pmtiles", "show", url, "--header-json"]),
        );
        const cliMetadata = yield* Effect.tryPromise(() =>
          inspect(["pmtiles", "show", url, "--metadata"]),
        );
        if (!validPmtilesHeaderJson(cliHeader) || !validPmtilesMetadataJson(cliMetadata))
          return yield* new CadastreWorkflowPmtilesError({
            message: "Public tile metadata mismatch",
          });
        const db = yield* Db;
        yield* db
          .transaction((tx) =>
            Effect.fn("CadastreSyncService.publishSnapshot")(function* () {
              const rows = yield* tx
                .select()
                .from(cadastreSnapshots)
                .where(eq(cadastreSnapshots.version, input.snapshotVersion));
              const row = rows[0];
              if (
                !row ||
                row.source !== input.source.objectKey ||
                row.lotCount !== input.lotCount ||
                (row.pmtilesStatus !== "building" &&
                  (row.pmtilesObjectKey !== input.objectKey || row.pmtilesStatus !== "published"))
              )
                throw new Error("Snapshot publication conflict");
              if (row.pmtilesStatus === "published") return true;
              const updated = yield* tx
                .update(cadastreSnapshots)
                .set({ pmtilesStatus: "published", pmtilesObjectKey: input.objectKey })
                .where(
                  and(
                    eq(cadastreSnapshots.version, input.snapshotVersion),
                    eq(cadastreSnapshots.pmtilesStatus, "building"),
                  ),
                )
                .returning({ version: cadastreSnapshots.version });
              if (updated.length !== 1) throw new Error("publication conflict");
              return true;
            })(),
          )
          .pipe(
            Effect.mapError(
              () =>
                new CadastreWorkflowPmtilesError({
                  message: "Snapshot publication transaction failed",
                }),
            ),
          );
        return {
          snapshotVersion: input.snapshotVersion,
          objectKey: input.objectKey,
          size: input.size,
          etag: input.etag,
          checksum: input.checksum,
          published: true as const,
        };
      })().pipe(
        Effect.mapError((error) =>
          error instanceof CadastreWorkflowConfigError ||
          error instanceof CadastreWorkflowPmtilesError
            ? error
            : new CadastreWorkflowPmtilesError({ message: "PMTiles verification failed" }),
        ),
      ),
    ),
  });
