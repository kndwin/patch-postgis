import { statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { Cause, Context, DateTime, Effect, Ref, Schema } from "effect";
import { PgClient } from "@effect/sql-pg";
import { Db } from "../../../platform/database/client";
import { cadastreSnapshots, cadastreSyncRuns } from "./cadastre-sync.model";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SyncError extends Schema.TaggedErrorClass<SyncError>()("SyncError", {
  message: Schema.String,
}) {}

export class SourceNotFoundError extends Schema.TaggedErrorClass<SourceNotFoundError>()(
  "SourceNotFoundError",
  { message: Schema.String },
) {}

export class SyncAlreadyRunningError extends Schema.TaggedErrorClass<SyncAlreadyRunningError>()(
  "SyncAlreadyRunningError",
  { message: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LIVE_TABLE = "cadastre_lots";
const IMPORT_LOCK = "cadastre_lots_import";

export function parseRunHash(objectKey: string): string {
  const match = /^runs\/([0-9a-f]{64})\/source\/export\.zip$/.exec(objectKey);
  if (!match) throw new Error("Invalid source object key");
  return match[1];
}

export function stagingIdentifiers(runHash: string): {
  readonly table: string;
  readonly index: string;
} {
  if (!/^[0-9a-f]{64}$/.test(runHash)) throw new Error("Invalid run hash");
  const suffix = runHash.slice(0, 20);
  return {
    table: `cadastre_lots_staging_${suffix}`,
    index: `cadastre_lots_staging_${suffix}_idx`,
  };
}

export function normalizeEtag(etag: string): string {
  return etag.trim().replace(/^"|"$/g, "");
}

// ---------------------------------------------------------------------------
// Pure helpers – exported so they can be tested without GDAL or Postgres
// ---------------------------------------------------------------------------

/** Parts extracted from a `postgres://` URL for ogr2ogr PG: strings. */
export interface PgConnParts {
  readonly host: string;
  readonly port: string;
  readonly dbname: string;
  readonly user: string;
  readonly password: string;
}

/**
 * Escape a value for use in an ogr2ogr `PG:` connection string.
 *
 * Values that contain spaces, single quotes, or backslashes must be wrapped
 * in single quotes and the special characters inside must be backslash-escaped
 * (per GDAL's PostgreSQL driver docs).
 */
function pgConnEscape(value: string): string {
  if (/[\s'\\]/.test(value)) {
    return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  }
  return value;
}

/**
 * Parse a `postgres://…` / `postgresql://…` URL into the components needed
 * by ogr2ogr's password-free `PG:host=… dbname=… user=…` connection string.
 *
 * Returns a password-free connection string, the decoded password for
 * PGPASSWORD, and a redacted version safe for diagnostic logging.
 */
export function parseDatabaseUrl(url: string): {
  readonly safePgConnString: string;
  readonly redacted: string;
  readonly password: string;
} {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid DATABASE_URL: could not parse as a URL");
  }
  if (
    (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
    parsed.hostname === ""
  ) {
    throw new Error(
      "Invalid DATABASE_URL: must be a postgres:// or postgresql:// URL with a hostname",
    );
  }
  const host = parsed.hostname;
  const port = parsed.port || "5432";
  const dbname = decodeURIComponent(parsed.pathname.replace(/^\//, "") || "postgres");
  const user = decodeURIComponent(parsed.username || "postgres");
  const password = decodeURIComponent(parsed.password || "");

  const parts: string[] = [
    `host=${pgConnEscape(host)}`,
    `port=${pgConnEscape(port)}`,
    `dbname=${pgConnEscape(dbname)}`,
    `user=${pgConnEscape(user)}`,
  ];
  const safePgConnString = parts.join(" ");

  const redactedParts: string[] = [
    `host=${host}`,
    `port=${port}`,
    `dbname=${dbname}`,
    `user=${user}`,
  ];
  if (password !== "") {
    redactedParts.push("password=***");
  }
  const redacted = redactedParts.join(" ");

  return { safePgConnString, redacted, password };
}

export function databaseToolEnvironment(
  password: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = { ...environment, PGPASSWORD: password };
  delete result.DATABASE_URL;
  return result;
}

/**
 * Resolve the source GDB path following the documented precedence:
 * 1. `explicitPath` CLI argument
 * 2. `CADASTRE_FILEGDB_PATH` environment variable
 * 3. Newest directory matching `*.gdb` inside `~/Downloads`
 *
 * Throws if no source is found or the resolved path is not an existing
 * directory.  The "no Lot layer" check is deferred to ogr2ogr so it can
 * produce a precise diagnostic.
 */
export function resolveSourcePath(explicitPath?: string): string {
  // 1 – explicit CLI path
  if (explicitPath !== undefined && explicitPath !== "") {
    const s = statSync(explicitPath);
    if (!s.isDirectory()) {
      throw new Error(`Source path "${explicitPath}" exists but is not a directory`);
    }
    return explicitPath;
  }

  // 2 – environment variable
  const envPath = process.env.CADASTRE_FILEGDB_PATH;
  if (envPath !== undefined && envPath !== "") {
    const s = statSync(envPath);
    if (!s.isDirectory()) {
      throw new Error(`CADASTRE_FILEGDB_PATH "${envPath}" exists but is not a directory`);
    }
    return envPath;
  }

  // 3 – newest *.gdb in ~/Downloads
  const home = process.env.HOME ?? homedir();
  const downloads = join(home, "Downloads");
  let dirs: string[];
  try {
    dirs = readdirSync(downloads, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.endsWith(".gdb"))
      .map((e) => join(downloads, e.name));
  } catch {
    throw new Error(
      `Cannot read ~/Downloads directory. Provide a path via CLI argument or CADASTRE_FILEGDB_PATH.`,
    );
  }

  if (dirs.length === 0) {
    throw new Error(
      `No *.gdb directory found in ~/Downloads. Provide a path via CLI argument or CADASTRE_FILEGDB_PATH.`,
    );
  }

  // Sort by mtime descending; newest first.
  dirs.sort((a, b) => {
    const ma = statSync(a).mtimeMs;
    const mb = statSync(b).mtimeMs;
    return mb - ma;
  });

  return dirs[0];
}

// ---------------------------------------------------------------------------
// SQL template literals (checked into source so the schema contract is
// explicit and reviewable)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ogr2ogr argument builder
// ---------------------------------------------------------------------------

/**
 * Build the `ogr2ogr` argument array.  Uses an argument array (never a
 * shell string) so there is no shell-injection surface.
 *
 * The staging table must already exist with the correct DDL (see
 * CREATE_STAGING_DDL above); we use `-append` so ogr2ogr never auto-creates
 * a weak-schema table.
 */
export function buildOgr2OgrArgs(
  sourcePath: string,
  safePgConnString: string,
  stagingTable: string,
): readonly string[] {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(stagingTable)) throw new Error("Invalid staging table");
  return [
    "--config",
    "PG_USE_COPY",
    "YES",
    "-f",
    "PostgreSQL",
    `PG:${safePgConnString}`,
    sourcePath,
    "-nln",
    stagingTable,
    "-append",
    "-nlt",
    "PROMOTE_TO_MULTI",
    "-s_srs",
    "EPSG:7844",
    "-t_srs",
    "EPSG:4326",
    "-lco",
    "GEOMETRY_NAME=geometry",
    "-sql",
    "SELECT cadid AS id, lotidstring AS lot_number, SHAPE AS geometry FROM Lot",
  ];
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/** Produce a clean error message when ogr2ogr exits non-zero. */
function ogr2OgrError(exitCode: number, redactedPg: string): string {
  return `ogr2ogr exited with code ${exitCode}. ` + `Connection: PG:${redactedPg}.`;
}

const quoteIdentifier = (identifier: string): string => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(identifier)) throw new Error("Invalid SQL identifier");
  return `"${identifier}"`;
};

/** Run GDAL in its own process group so interruption cannot orphan its helpers. */
export const runOgr2Ogr = Effect.fn("CadastreSyncService.runOgr2Ogr")(function* (
  args: readonly string[],
  environment: Record<string, string | undefined>,
) {
  return yield* Effect.acquireUseRelease(
    Effect.try({
      try: () =>
        Bun.spawn(["ogr2ogr", ...args], {
          stdout: "pipe",
          stderr: "pipe",
          env: environment,
          detached: true,
        }),
      catch: () => new SyncError({ message: "GDAL/ogr2ogr is required but could not be started" }),
    }),
    (proc: Bun.Subprocess) => {
      const stderr =
        proc.stderr && typeof proc.stderr !== "number"
          ? new Response(proc.stderr).text()
          : Promise.resolve("");
      const stdout =
        proc.stdout && typeof proc.stdout !== "number"
          ? new Response(proc.stdout).text()
          : Promise.resolve("");
      return Effect.promise(() => Promise.all([proc.exited, stdout, stderr])).pipe(
        Effect.map(([exitCode, stdoutText, stderrText]) => ({
          exitCode,
          stdout: stdoutText,
          stderr: stderrText,
        })),
      );
    },
    (process: Bun.Subprocess) =>
      Effect.sync(() => {
        try {
          // detached Bun children are process-group leaders on POSIX.
          process.kill("SIGTERM");
          if (process.pid !== undefined) globalThis.process.kill(-process.pid, "SIGTERM");
        } catch {
          // It may have exited between the check and the signal.
        }
      }).pipe(
        Effect.andThen(
          Effect.promise(() => process.exited).pipe(
            Effect.timeoutOption("5 seconds"),
            Effect.flatMap((exited) =>
              exited._tag === "Some"
                ? Effect.void
                : Effect.sync(() => {
                    try {
                      process.kill("SIGKILL");
                      if (process.pid !== undefined)
                        globalThis.process.kill(-process.pid, "SIGKILL");
                    } catch {
                      // Already gone.
                    }
                  }),
            ),
          ),
        ),
      ),
  );
});

// ---------------------------------------------------------------------------
// Sync service
// ---------------------------------------------------------------------------

export interface SyncResult {
  readonly source: string;
  readonly count: number;
  readonly durationMs: number;
}

export interface ImportedCadastre {
  readonly source: {
    readonly objectKey: string;
    readonly size: number;
    readonly etag: string;
    readonly checksum: string;
  };
  readonly runHash: string;
  readonly stagingTable: string;
  readonly stagingIndex: string;
  readonly lotCount: number;
}
export interface PromotedCadastre {
  readonly source: ImportedCadastre["source"];
  readonly runHash: string;
  readonly snapshotVersion: string;
  readonly liveTable: "cadastre_lots";
  readonly lotCount: number;
}
interface CadastreSyncServiceContract {
  readonly importToStaging: (
    sourcePath: string,
    runHash: string,
    source: ImportedCadastre["source"],
  ) => Effect.Effect<ImportedCadastre, SyncError | SyncAlreadyRunningError, unknown>;
  readonly validateAndPromote: (
    imported: ImportedCadastre,
  ) => Effect.Effect<PromotedCadastre, SyncError, unknown>;
  readonly sync: (explicitPath?: string) => Effect.Effect<
    SyncResult,
    SyncError | SourceNotFoundError | SyncAlreadyRunningError,
    // Effect.fn captures the enclosing context as unknown; the caller never
    // needs to provide it because the service layer already wires Db.
    unknown
  >;
}

/** Wrap any unexpected error (including Drizzle query errors) as SyncError. */
const wrapDbOps = <A, E, R>(
  eff: Effect.Effect<A, E, R>,
  message: string,
): Effect.Effect<A, SyncError, R> =>
  eff.pipe(
    Effect.catchCause((cause) =>
      Effect.fail(
        new SyncError({
          message: `${message}: ${Cause.pretty(cause)}`,
        }),
      ),
    ),
  );

export class CadastreSyncService extends Context.Service<
  CadastreSyncService,
  CadastreSyncServiceContract
>()("CadastreSyncService", {
  make: Effect.fn("CadastreSyncService.make")(function* () {
    const db = yield* Db;
    const pg = yield* PgClient.PgClient;
    const runningRef = yield* Ref.make(false);

    const importToStaging = Effect.fn("CadastreSyncService.importToStaging")(function* (
      sourcePath: string,
      runHash: string,
      source: ImportedCadastre["source"],
    ) {
      const ids = yield* Effect.try({
        try: () => stagingIdentifiers(runHash),
        catch: (e) => new SyncError({ message: String(e) }),
      });
      const rawUrl =
        process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/patch_postgis";
      const { safePgConnString, redacted: redactedPg, password } = parseDatabaseUrl(rawUrl);
      return yield* Effect.scoped(
        Effect.fn("CadastreSyncService.importWithLock")(function* () {
          // This connection must remain checked out for the complete import:
          // ordinary Drizzle statements and ogr2ogr use other connections.
          const reserved = yield* pg.reserve;
          let locked = false;
          const lock = function acquireImportLock(): Effect.Effect<void, unknown, unknown> {
            return Effect.fn("CadastreSyncService.acquireImportLock")(function* () {
              const result = yield* reserved.executeRaw(
                "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
                [IMPORT_LOCK],
              );
              locked = Boolean((result as { rows: { locked: boolean }[] }).rows[0]?.locked);
              if (!locked) {
                yield* Effect.sleep("5 seconds");
                return yield* lock();
              }
            })();
          };
          yield* lock().pipe(
            Effect.timeoutOrElse({
              duration: "30 minutes",
              orElse: () =>
                Effect.fail(
                  new SyncAlreadyRunningError({ message: "Another cadastre import is active" }),
                ),
            }),
          );
          let completed = false;
          return yield* Effect.fn("CadastreSyncService.runImport")(function* () {
            yield* wrapDbOps(
              db.execute(sql.raw(`DROP TABLE IF EXISTS ${quoteIdentifier(ids.table)}`)),
              "Failed to reset staging table",
            );
            yield* wrapDbOps(
              db.execute(
                sql.raw(
                  `CREATE TABLE ${quoteIdentifier(ids.table)} (id text PRIMARY KEY, lot_number text NOT NULL, geometry geometry(MultiPolygon,4326))`,
                ),
              ),
              "Failed to create staging table",
            );
            const args = buildOgr2OgrArgs(sourcePath, safePgConnString, ids.table);
            const { exitCode } = yield* runOgr2Ogr(args, databaseToolEnvironment(password));
            if (exitCode !== 0)
              return yield* new SyncError({ message: ogr2OgrError(exitCode, redactedPg) });
            yield* wrapDbOps(
              db.execute(
                sql.raw(
                  `CREATE INDEX ${quoteIdentifier(ids.index)} ON ${quoteIdentifier(ids.table)} USING gist (geometry)`,
                ),
              ),
              "Failed to create staging index",
            );
            const result = yield* wrapDbOps(
              db.execute<Record<string, unknown>>(
                sql.raw(`SELECT COUNT(*)::int AS cnt FROM ${quoteIdentifier(ids.table)}`),
              ),
              "Failed to count staging rows",
            );
            const lotCount = Number(
              (result as unknown as { rows: { cnt: number }[] }).rows[0]?.cnt ?? 0,
            );
            if (lotCount <= 0)
              return yield* new SyncError({ message: "Imported staging table contains no lots" });
            completed = true;
            return {
              source,
              runHash,
              stagingTable: ids.table,
              stagingIndex: ids.index,
              lotCount,
            } satisfies ImportedCadastre;
          })().pipe(
            Effect.ensuring(
              Effect.uninterruptible(
                Effect.fn("CadastreSyncService.cleanupImport")(function* () {
                  if (!completed)
                    yield* db
                      .execute(sql.raw(`DROP TABLE IF EXISTS ${quoteIdentifier(ids.table)}`))
                      .pipe(Effect.catchCause(() => Effect.succeed(undefined)));
                  if (locked)
                    yield* reserved
                      .executeRaw("SELECT pg_advisory_unlock(hashtext($1))", [IMPORT_LOCK])
                      .pipe(Effect.catchCause(() => Effect.succeed(undefined)));
                })(),
              ).pipe(Effect.catchCause(() => Effect.void)),
            ),
          );
        })(),
      ).pipe(
        Effect.mapError((error) =>
          error instanceof SyncAlreadyRunningError || error instanceof SyncError
            ? error
            : new SyncError({ message: `Import failed: ${String(error)}` }),
        ),
      );
    });
    const validateAndPromote = Effect.fn("CadastreSyncService.validateAndPromote")(function* (
      imported: ImportedCadastre,
    ) {
      const ids = yield* Effect.try({
        try: () => stagingIdentifiers(imported.runHash),
        catch: (e) => new SyncError({ message: String(e) }),
      });
      if (ids.table !== imported.stagingTable || ids.index !== imported.stagingIndex)
        return yield* new SyncError({ message: "Invalid staging metadata" });
      yield* wrapDbOps(
        db.transaction((tx) =>
          Effect.fn("CadastreSyncService.promoteSnapshot")(function* () {
            yield* tx.execute(
              sql.raw("SELECT pg_advisory_xact_lock(hashtext('cadastre_lots_promotion'))"),
            );
            const existingRow = (yield* tx
              .select({ source: cadastreSnapshots.source, lotCount: cadastreSnapshots.lotCount })
              .from(cadastreSnapshots)
              .where(eq(cadastreSnapshots.version, imported.runHash))
              .limit(1))[0];
            if (existingRow) {
              if (
                existingRow.source !== imported.source.objectKey ||
                existingRow.lotCount !== imported.lotCount
              )
                return yield* Effect.fail(
                  new SyncError({
                    message: "Snapshot identity conflicts with existing snapshot",
                  }),
                );
              yield* tx.execute(sql.raw(`DROP TABLE IF EXISTS ${quoteIdentifier(ids.table)}`));
              return;
            }
            const check = yield* tx.execute<Record<string, unknown>>(
              sql.raw(
                `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE id IS NULL OR btrim(id) = '' OR lot_number IS NULL OR btrim(lot_number) = '' OR geometry IS NULL OR ST_SRID(geometry) <> 4326 OR GeometryType(geometry) <> 'MULTIPOLYGON' OR NOT ST_IsValid(geometry))::int AS invalid FROM ${quoteIdentifier(ids.table)}`,
              ),
            );
            const row = (check as unknown as { rows: { total: number; invalid: number }[] })
              .rows[0];
            if (
              !row ||
              Number(row.total) <= 0 ||
              Number(row.total) !== imported.lotCount ||
              Number(row.invalid) !== 0
            )
              return yield* new SyncError({ message: "Staging validation failed" });
            yield* tx.execute(sql.raw(`DROP TABLE IF EXISTS ${quoteIdentifier(LIVE_TABLE)}`));
            yield* tx.execute(
              sql.raw(
                `ALTER TABLE ${quoteIdentifier(ids.table)} RENAME TO ${quoteIdentifier(LIVE_TABLE)}`,
              ),
            );
            yield* tx.execute(
              sql.raw(
                `ALTER INDEX ${quoteIdentifier(ids.index)} RENAME TO ${quoteIdentifier("cadastre_lots_geometry_idx")}`,
              ),
            );
            yield* tx.insert(cadastreSnapshots).values({
              version: imported.runHash,
              source: imported.source.objectKey,
              lotCount: imported.lotCount,
              importedAt: DateTime.toDate(yield* DateTime.now),
              pmtilesStatus: "building",
              pmtilesObjectKey: null,
            });
          })(),
        ),
        "Failed to validate and promote snapshot",
      );
      return {
        source: imported.source,
        runHash: imported.runHash,
        snapshotVersion: imported.runHash,
        liveTable: "cadastre_lots",
        lotCount: imported.lotCount,
      } satisfies PromotedCadastre;
    });
    return {
      importToStaging,
      validateAndPromote,
      sync: Effect.fn("CadastreSyncService.sync")(function* (explicitPath?: string) {
        // ----- concurrency guard -----
        const wasRunning = yield* Ref.modify(runningRef, (v) => [v, true]);
        if (wasRunning) {
          return yield* new SyncAlreadyRunningError({
            message: "A sync is already in progress; only one local sync may run at a time.",
          });
        }

        const startedAtDateTime = yield* DateTime.now;
        const startedAt = DateTime.toEpochMillis(startedAtDateTime);
        const runId = crypto.randomUUID();
        let completed = false;
        try {
          yield* wrapDbOps(
            db.insert(cadastreSyncRuns).values({
              id: runId,
              status: "running",
              phase: "resolve_source",
              startedAt: DateTime.toDate(startedAtDateTime),
            }),
            "Failed to record sync run",
          );
          // ----- source resolution -----
          let source: string;
          try {
            source = resolveSourcePath(explicitPath);
          } catch (err) {
            return yield* new SourceNotFoundError({
              message: err instanceof Error ? err.message : String(err),
            });
          }

          yield* wrapDbOps(
            db
              .update(cadastreSyncRuns)
              .set({ source, phase: "prepare_staging" })
              .where(eq(cadastreSyncRuns.id, runId)),
            "Failed to update sync phase",
          );

          const hashBuffer = yield* Effect.promise(() =>
            crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${runId}\0${source}`)),
          );
          const runHash = Array.from(new Uint8Array(hashBuffer), (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          const sourceMeta = { objectKey: source, size: 0, etag: "local", checksum: "" };
          yield* wrapDbOps(
            db
              .update(cadastreSyncRuns)
              .set({ phase: "import_gdb" })
              .where(eq(cadastreSyncRuns.id, runId)),
            "Failed to update sync phase",
          );
          const imported = yield* importToStaging(source, runHash, sourceMeta);
          yield* wrapDbOps(
            db
              .update(cadastreSyncRuns)
              .set({ phase: "validate_snapshot" })
              .where(eq(cadastreSyncRuns.id, runId)),
            "Failed to update sync phase",
          );
          const promoted = yield* validateAndPromote(imported);
          const count = promoted.lotCount;

          const finishedAtDateTime = yield* DateTime.now;
          const durationMs = DateTime.toEpochMillis(finishedAtDateTime) - startedAt;

          // PMTiles download/build/upload adapters are intentionally not run by
          // this local GDB coordinator yet.
          const version = promoted.snapshotVersion;
          yield* wrapDbOps(
            db
              .update(cadastreSyncRuns)
              .set({
                status: "succeeded",
                phase: "complete",
                snapshotVersion: version,
                finishedAt: DateTime.toDate(yield* DateTime.now),
              })
              .where(eq(cadastreSyncRuns.id, runId)),
            "Failed to complete sync run",
          );
          completed = true;

          return { source, count, durationMs } satisfies SyncResult;
        } finally {
          if (!completed) {
            yield* wrapDbOps(
              db
                .update(cadastreSyncRuns)
                .set({
                  status: "failed",
                  phase: "failed",
                  error: "sync failed before promotion or snapshot recording",
                  finishedAt: DateTime.toDate(yield* DateTime.now),
                })
                .where(eq(cadastreSyncRuns.id, runId)),
              "Failed to record failed sync run",
            ).pipe(Effect.catchCause(() => Effect.succeed(undefined)));
          }
          yield* Ref.set(runningRef, false);
        }
      }),
    };
  })(),
}) {}
