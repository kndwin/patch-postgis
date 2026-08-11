import { mkdtemp, rm, statfs, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Clock, Config, Duration, Effect, Semaphore } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import {
  CadastreActivityErrorSchema,
  BuildPmtilesInputSchema,
  BuildPmtilesSuccessSchema,
} from "./build-pmtiles.activity.schema";
import {
  CadastreWorkflowConfigError,
  CadastreWorkflowPmtilesError,
} from "./cadastre-workflow-error.schema";
import { databaseToolEnvironment, parseDatabaseUrl } from "../../sync/cadastre-sync.service";
import {
  validPmtilesHeaderJson,
  validPmtilesMetadataJson,
  isSha256,
  normalizeEtag,
  normalizeTileBaseUrl,
} from "../../../../platform/cadastre/pmtiles.boundary";
import { recordPmtilesBuilt } from "../../../../platform/observability/cadastre.metrics";

const PART_SIZE = 64 * 1024 * 1024;
const MIN_FREE = 20 * 1024 * 1024 * 1024;
const fail = (message: string) => new CadastreWorkflowPmtilesError({ message });
const configFail = (message: string) => new CadastreWorkflowConfigError({ message });
const buildSemaphore = Semaphore.makeUnsafe(1);
const drain = async (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {}
};
const checksumFile = async (file: string) => {
  const hash = createHash("sha256");
  for await (const chunk of Bun.file(file).stream()) hash.update(chunk);
  return hash.digest("hex");
};

export const safePgArgs = (databaseUrl: string, table = "cadastre_lots") => {
  const { safePgConnString } = parseDatabaseUrl(databaseUrl);
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error("Invalid table");
  return [
    "-f",
    "GeoJSONSeq",
    "/vsistdout/",
    `PG:${safePgConnString}`,
    "-sql",
    `SELECT id, lot_number, ST_Force2D(geometry) AS geometry FROM ${table}`,
    "-dim",
    "2",
    "-t_srs",
    "EPSG:4326",
  ] as const;
};

export const tippecanoeArgs = (output: string, temporaryDirectory: string) =>
  [
    "-o",
    output,
    "-l",
    "lots",
    "-Z",
    "14",
    "-z",
    "18",
    "--no-feature-limit",
    "--no-tile-size-limit",
    "--detect-shared-borders",
    "--no-simplification-of-shared-nodes",
    "--no-progress-indicator",
    `--temporary-directory=${temporaryDirectory}`,
    "-f",
    "/dev/stdin",
  ] as const;

const pipeExportToTippecanoe = async (
  databaseUrl: string,
  password: string,
  output: string,
  temporaryDirectory: string,
) => {
  const ogr = Bun.spawn(["ogr2ogr", ...safePgArgs(databaseUrl)], {
    stdout: "pipe",
    stderr: "pipe",
    env: databaseToolEnvironment(password),
  });
  const tip = Bun.spawn(["tippecanoe", ...tippecanoeArgs(output, temporaryDirectory)], {
    stdin: ogr.stdout!,
    stdout: "pipe",
    stderr: "pipe",
  });
  const streams = [
    ogr.stderr && typeof ogr.stderr !== "number" ? drain(ogr.stderr) : Promise.resolve(),
    tip.stdout && typeof tip.stdout !== "number" ? drain(tip.stdout) : Promise.resolve(),
    tip.stderr && typeof tip.stderr !== "number" ? drain(tip.stderr) : Promise.resolve(),
  ];
  const [[ogrCode, tipCode]] = await Promise.all([
    Promise.all([ogr.exited, tip.exited]),
    ...streams,
  ]);
  if (ogrCode !== 0 || tipCode !== 0) throw new Error("Required geospatial process failed");
};

const command = async (args: string[], cwd?: string) => {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const stdout =
    proc.stdout && typeof proc.stdout !== "number" ? drain(proc.stdout) : Promise.resolve();
  const stderr =
    proc.stderr && typeof proc.stderr !== "number" ? drain(proc.stderr) : Promise.resolve();
  const [code] = await Promise.all([proc.exited, stdout, stderr]);
  if (code !== 0) throw new Error(`Required geospatial process failed (${code})`);
};
const commandText = async (args: string[]) => {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const stdout =
    proc.stdout && typeof proc.stdout !== "number"
      ? new Response(proc.stdout).text()
      : Promise.resolve("");
  const stderr =
    proc.stderr && typeof proc.stderr !== "number" ? drain(proc.stderr) : Promise.resolve();
  const [code, output] = await Promise.all([proc.exited, stdout, stderr]);
  if (code !== 0) throw new Error("PMTiles inspection failed");
  return output;
};

const upload = async (
  url: string,
  token: string,
  key: string,
  file: string,
  size: number,
  runHash: string,
  checksum: string,
) => {
  const auth = { authorization: `Bearer ${token}` };
  const create = await fetch(`${url}/_publish?objectKey=${encodeURIComponent(key)}&action=create`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ action: "create", expectedSize: size, runHash, checksum }),
  });
  if (!create.ok) throw new Error("PMTiles multipart session could not be created");
  const created = (await create.json()) as {
    uploadId?: string;
    objectKey?: string;
    size?: number;
    etag?: string;
    expectedSize?: string;
    runHash?: string;
    checksum?: string;
  };
  if (
    created.objectKey === key &&
    created.size === size &&
    created.expectedSize === String(size) &&
    created.runHash === runHash &&
    normalizeEtag(created.etag) !== null &&
    created.checksum === checksum
  )
    return normalizeEtag(created.etag)!;
  if (typeof created.uploadId !== "string") throw new Error("Invalid multipart session response");
  const parts: { partNumber: number; etag: string }[] = [];
  let completed = false;
  try {
    for (let offset = 0, partNumber = 1; offset < size; offset += PART_SIZE, partNumber++) {
      const bytes = new Uint8Array(
        await Bun.file(file)
          .slice(offset, offset + Math.min(PART_SIZE, size - offset))
          .arrayBuffer(),
      );
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(
          `${url}/_publish?objectKey=${encodeURIComponent(key)}&action=part&uploadId=${encodeURIComponent(created.uploadId)}&partNumber=${partNumber}`,
          { method: "PUT", headers: auth, body: bytes },
        );
        if (response.ok) break;
      }
      if (!response?.ok) throw new Error("PMTiles multipart part failed");
      const part = (await response.json()) as { partNumber?: number; etag?: string };
      if (part.partNumber !== partNumber || typeof part.etag !== "string")
        throw new Error("Invalid multipart part response");
      parts.push({ partNumber, etag: part.etag });
    }
    const complete = await fetch(
      `${url}/_publish?objectKey=${encodeURIComponent(key)}&action=complete&uploadId=${encodeURIComponent(created.uploadId)}`,
      {
        method: "POST",
        headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ parts, expectedSize: size, runHash, checksum }),
      },
    );
    if (!complete.ok) throw new Error("PMTiles multipart completion failed");
    const result = (await complete.json()) as {
      objectKey?: string;
      size?: number;
      rawEtag?: string;
      checksum?: string;
    };
    if (
      result.objectKey !== key ||
      result.size !== size ||
      normalizeEtag(result.rawEtag) === null ||
      result.checksum !== checksum
    )
      throw new Error("Invalid completed PMTiles metadata");
    completed = true;
    return normalizeEtag(result.rawEtag)!;
  } finally {
    if (!completed) {
      try {
        await fetch(
          `${url}/_publish?objectKey=${encodeURIComponent(key)}&action=abort&uploadId=${encodeURIComponent(created.uploadId)}`,
          { method: "DELETE", headers: auth },
        );
      } catch {
        // Cleanup must not hide the original upload failure.
      }
    }
  }
};

export const BuildPmtilesActivity = (input: typeof BuildPmtilesInputSchema.Type) =>
  Activity.make({
    name: "CadastreSyncWorkflow/build-pmtiles",
    error: CadastreActivityErrorSchema,
    success: BuildPmtilesSuccessSchema,
    execute: projectActivity(
      "build-pmtiles",
      Effect.fn("CadastreSyncWorkflow.buildPmtiles.execute")(function* () {
        const buildStartedAt = yield* Clock.currentTimeNanos;
        const work = yield* Config.string("CADASTRE_WORK_DIR").pipe(
          Config.withDefault("/tmp"),
          Effect.mapError(() => configFail("Invalid work directory configuration")),
        );
        const databaseUrl = yield* Config.string("DATABASE_URL").pipe(
          Config.withDefault("postgres://postgres:postgres@localhost:5432/patch_postgis"),
          Effect.mapError(() => configFail("Invalid database configuration")),
        );
        const tileUrl = yield* Config.string("CADASTRE_TILE_URL").pipe(
          Effect.mapError(() => configFail("CADASTRE_TILE_URL is required")),
        );
        const token = yield* Config.string("CADASTRE_TILE_PUBLISH_TOKEN").pipe(
          Effect.mapError(() => configFail("CADASTRE_TILE_PUBLISH_TOKEN is required")),
        );
        if (!token || !tileUrl.trim() || !databaseUrl.trim())
          return yield* configFail("Required PMTiles configuration is blank");
        const normalizedTileUrl = normalizeTileBaseUrl(tileUrl);
        if (!normalizedTileUrl)
          return yield* configFail("CADASTRE_TILE_URL must be an HTTP(S) URL without credentials");
        yield* Effect.promise(() => mkdir(work, { recursive: true }));
        const space = yield* Effect.promise(() => statfs(work));
        if (space.bavail * space.bsize < MIN_FREE)
          return yield* fail("Insufficient filesystem headroom for PMTiles build");
        const dir = yield* Effect.promise(() => mkdtemp(join(work, "pmtiles-")));
        const mbtiles = join(dir, "lots.mbtiles");
        const pmtiles = join(dir, "lots.pmtiles");
        const key = `runs/${input.runHash}/tiles/lots.pmtiles`;
        try {
          yield* Effect.promise(() =>
            pipeExportToTippecanoe(
              databaseUrl,
              parseDatabaseUrl(databaseUrl).password,
              mbtiles,
              dir,
            ),
          );
          yield* Effect.promise(() => command(["pmtiles", "convert", mbtiles, pmtiles]));
          yield* Effect.promise(() => command(["pmtiles", "verify", pmtiles]));
          const header = yield* Effect.promise(() =>
            commandText(["pmtiles", "show", pmtiles, "--header-json"]),
          );
          const metadata = yield* Effect.promise(() =>
            commandText(["pmtiles", "show", pmtiles, "--metadata"]),
          );
          if (!validPmtilesHeaderJson(header) || !validPmtilesMetadataJson(metadata))
            return yield* fail("PMTiles metadata does not match the lots MVT contract");
          const info = yield* Effect.promise(() => stat(pmtiles));
          if (info.size <= 0) return yield* fail("PMTiles output is empty");
          const checksum = yield* Effect.promise(() => checksumFile(pmtiles));
          if (!isSha256(checksum)) return yield* fail("PMTiles checksum failed");
          const etag = yield* Effect.promise(() =>
            upload(normalizedTileUrl, token, key, pmtiles, info.size, input.runHash, checksum),
          );
          const buildFinishedAt = yield* Clock.currentTimeNanos;
          yield* recordPmtilesBuilt(Duration.nanos(buildFinishedAt - buildStartedAt), info.size);
          return {
            source: input.source,
            runHash: input.runHash,
            snapshotVersion: input.snapshotVersion,
            lotCount: input.lotCount,
            objectKey: key,
            size: info.size,
            etag,
            checksum,
            minZoom: 14 as const,
            maxZoom: 18 as const,
            layer: "lots" as const,
            tileType: "mvt" as const,
          };
        } catch {
          return yield* fail("PMTiles build failed");
        } finally {
          yield* Effect.promise(() =>
            rm(dir, { recursive: true, force: true }).catch(() => undefined),
          );
        }
      })().pipe(
        Effect.mapError((error) =>
          error instanceof CadastreWorkflowConfigError ||
          error instanceof CadastreWorkflowPmtilesError
            ? error
            : fail("PMTiles build failed"),
        ),
        (effect) => buildSemaphore.withPermit(effect),
      ),
    ),
  });
