import { Config, Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { CadastreSyncService, normalizeEtag, parseRunHash } from "../../sync/cadastre-sync.service";
import {
  CadastreActivityErrorSchema,
  ImportPostgisInputSchema,
  ImportPostgisSuccessSchema,
} from "./import-postgis.activity.schema";
import {
  CadastreWorkflowConfigError,
  CadastreWorkflowHttpError,
  CadastreWorkflowPostgisError,
} from "./cadastre-workflow-error.schema";

export function fileGdbRoot(entries: readonly string[]): string {
  if (entries.length === 0) throw new Error("Archive is empty");
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry ||
      seen.has(entry) ||
      entry.startsWith("/") ||
      /^[A-Za-z]:/.test(entry) ||
      entry.includes("\\") ||
      entry.split("/").includes("..")
    )
      throw new Error("Invalid archive entries");
    seen.add(entry);
  }
  const roots = [...new Set(entries.map((x) => x.split("/")[0]))];
  if (roots.length !== 1 || !roots[0].endsWith(".gdb"))
    throw new Error("Archive must contain exactly one top-level GDB");
  return roots[0];
}

const command = (args: string[]) =>
  Effect.tryPromise({
    try: async () => {
      const process = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
      const stdout =
        process.stdout && typeof process.stdout !== "number"
          ? new Response(process.stdout).text()
          : Promise.resolve("");
      const stderr =
        process.stderr && typeof process.stderr !== "number"
          ? new Response(process.stderr).text()
          : Promise.resolve("");
      const [code, output] = await Promise.all([process.exited, stdout, stderr]);
      if (code !== 0) throw new Error("Command failed");
      return output;
    },
    catch: () => new Error("Command failed"),
  });
export const ImportPostgisActivity = (input: typeof ImportPostgisInputSchema.Type) =>
  Activity.make({
    name: "CadastreSyncWorkflow/import-postgis",
    error: CadastreActivityErrorSchema,
    success: ImportPostgisSuccessSchema,
    execute: projectActivity(
      "import-postgis",
      Effect.fn("CadastreSyncWorkflow.importPostgis.execute")(function* () {
        const url = yield* Config.string("CADASTRE_ARTIFACT_URL").pipe(
          Effect.mapError(
            () =>
              new CadastreWorkflowConfigError({
                message: "Artifact URL is not configured",
              }),
          ),
        );
        const token = yield* Config.string("CADASTRE_ARTIFACT_TOKEN").pipe(
          Effect.mapError(
            () =>
              new CadastreWorkflowConfigError({
                message: "Artifact token is not configured",
              }),
          ),
        );
        const work = yield* Config.string("CADASTRE_WORK_DIR").pipe(Config.withDefault("/tmp"));
        if (!url.trim() || !token.trim())
          return yield* new CadastreWorkflowConfigError({
            message: "Artifact URL and token are required",
          });
        const runHash = yield* Effect.try({
          try: () => parseRunHash(input.source.objectKey),
          catch: () =>
            new CadastreWorkflowPostgisError({
              message: "Invalid source object key",
            }),
        });
        const dir = yield* Effect.tryPromise({
          try: async () => {
            await mkdir(work, { recursive: true });
            return mkdtemp(join(work, "cadastre-import-"));
          },
          catch: () =>
            new CadastreWorkflowPostgisError({
              message: "Unable to create import workspace",
            }),
        });
        return yield* Effect.fn("CadastreSyncWorkflow.importPostgis.run")(function* () {
          const zip = join(dir, "source.zip");
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(
                `${url.replace(/\/$/, "")}/source?objectKey=${encodeURIComponent(input.source.objectKey)}`,
                { headers: { authorization: `Bearer ${token}` } },
              ),
            catch: () =>
              new CadastreWorkflowHttpError({
                message: "Artifact download failed",
              }),
          });
          if (!response.ok || !response.body)
            return yield* new CadastreWorkflowHttpError({
              message: "Artifact download failed",
            });
          const contentLength = response.headers.get("content-length");
          const etag = response.headers.get("etag");
          if (
            (contentLength && Number(contentLength) !== input.source.size) ||
            !etag ||
            normalizeEtag(etag) !== normalizeEtag(input.source.etag)
          )
            return yield* new CadastreWorkflowHttpError({
              message: "Artifact metadata mismatch",
            });
          const file = yield* Effect.tryPromise({
            try: () => open(zip, "w"),
            catch: () =>
              new CadastreWorkflowPostgisError({
                message: "Unable to materialize artifact",
              }),
          });
          let bytes = 0;
          const reader = response.body.getReader();
          try {
            while (true) {
              const chunk = yield* Effect.promise(() => reader.read());
              if (chunk.done) break;
              bytes += chunk.value.byteLength;
              if (bytes > 2 * 1024 * 1024 * 1024)
                return yield* new CadastreWorkflowHttpError({
                  message: "Artifact is too large",
                });
              let offset = 0;
              while (offset < chunk.value.byteLength) {
                const result = yield* Effect.promise(() =>
                  file.write(chunk.value.subarray(offset)),
                );
                if (result.bytesWritten === 0)
                  return yield* new CadastreWorkflowPostgisError({
                    message: "Unable to materialize artifact",
                  });
                offset += result.bytesWritten;
              }
            }
          } finally {
            yield* Effect.promise(() => file.close());
          }
          if (bytes !== input.source.size)
            return yield* new CadastreWorkflowHttpError({
              message: "Artifact size mismatch",
            });
          yield* command(["unzip", "-tq", zip]).pipe(
            Effect.mapError(() => new CadastreWorkflowPostgisError({ message: "Invalid archive" })),
          );
          const listingText = yield* command(["unzip", "-Z1", zip]).pipe(
            Effect.mapError(() => new CadastreWorkflowPostgisError({ message: "Invalid archive" })),
          );
          const listing = listingText
            .split("\n")
            .map((entry) => entry.replace(/\/$/, ""))
            .filter(Boolean);
          let root: string;
          try {
            root = fileGdbRoot(listing);
          } catch {
            return yield* new CadastreWorkflowPostgisError({ message: "Invalid archive entries" });
          }
          const gdalPath = `/vsizip/${zip}/${root}`;
          yield* command(["ogrinfo", "-ro", "-so", gdalPath, "Lot"]).pipe(
            Effect.mapError(
              () =>
                new CadastreWorkflowPostgisError({
                  message: "Invalid FileGDB Lot layer",
                }),
            ),
          );
          const service = yield* CadastreSyncService;
          return yield* service
            .importToStaging(gdalPath, runHash, input.source)
            .pipe(Effect.mapError((e) => new CadastreWorkflowPostgisError({ message: e.message })));
        })().pipe(
          Effect.ensuring(
            Effect.promise(() => rm(dir, { recursive: true, force: true })).pipe(
              Effect.catchCause(() => Effect.succeed(undefined)),
            ),
          ),
        );
      })().pipe(
        Effect.mapError((e) =>
          e instanceof CadastreWorkflowConfigError ||
          e instanceof CadastreWorkflowHttpError ||
          e instanceof CadastreWorkflowPostgisError
            ? e
            : new CadastreWorkflowPostgisError({
                message: "PostGIS import failed",
              }),
        ),
      ),
    ),
  });
