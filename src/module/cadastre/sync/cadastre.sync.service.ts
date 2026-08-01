import { statSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { Cause, Context, Effect, Redacted, Ref, Schema } from "effect";
import { Db } from "../../../platform/db/client";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SyncError extends Schema.TaggedErrorClass<SyncError>()(
  "SyncError",
  { message: Schema.String },
) {}

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

const STAGING_TABLE = "cadastre_lots_staging";
const LIVE_TABLE = "cadastre_lots";
const STAGING_IDX = `${STAGING_TABLE}_geometry_idx`;
const LIVE_IDX = "cadastre_lots_geometry_idx";

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
 * by ogr2ogr's `PG:host=… dbname=… user=… password=…` connection string.
 *
 * Returns both the real (properly escaped) connection string and a redacted
 * version safe for diagnostic logging.
 */
export function parseDatabaseUrl(url: string): {
  readonly pgConnString: string;
  readonly redacted: string;
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
  const dbname = decodeURIComponent(
    parsed.pathname.replace(/^\//, "") || "postgres",
  );
  const user = decodeURIComponent(parsed.username || "postgres");
  const password = decodeURIComponent(parsed.password || "");

  const parts: string[] = [
    `host=${pgConnEscape(host)}`,
    `port=${pgConnEscape(port)}`,
    `dbname=${pgConnEscape(dbname)}`,
    `user=${pgConnEscape(user)}`,
  ];
  if (password !== "") {
    parts.push(`password=${pgConnEscape(password)}`);
  }
  const pgConnString = parts.join(" ");

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

  return { pgConnString, redacted };
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
      throw new Error(
        `Source path "${explicitPath}" exists but is not a directory`,
      );
    }
    return explicitPath;
  }

  // 2 – environment variable
  const envPath = process.env.CADASTRE_FILEGDB_PATH;
  if (envPath !== undefined && envPath !== "") {
    const s = statSync(envPath);
    if (!s.isDirectory()) {
      throw new Error(
        `CADASTRE_FILEGDB_PATH "${envPath}" exists but is not a directory`,
      );
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

/**
 * DDL that creates the staging table with the exact contract the live
 * `cadastre_lots` table must carry after promotion:
 *   - `id text PRIMARY KEY`
 *   - `lot_number text NOT NULL`
 *   - `geometry geometry(MultiPolygon,4326)`
 *
 * The GiST index is created separately *after* bulk import so the import
 * is not slowed down by index maintenance.
 */
const CREATE_STAGING_DDL = `
  CREATE TABLE IF NOT EXISTS ${STAGING_TABLE} (
    id      text PRIMARY KEY,
    lot_number text NOT NULL,
    geometry   geometry(MultiPolygon,4326)
  )
`;

/** GiST spatial index created after ogr2ogr completes. */
const CREATE_STAGING_GIST = `
  CREATE INDEX IF NOT EXISTS ${STAGING_IDX}
    ON ${STAGING_TABLE} USING gist (geometry)
`;

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
  pgConnString: string,
): readonly string[] {
  return [
    "-f",
    "PostgreSQL",
    `PG:${pgConnString}`,
    sourcePath,
    "-nln",
    STAGING_TABLE,
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
function ogr2OgrError(
  exitCode: number,
  stderr: string,
  redactedPg: string,
): string {
  const tail = stderr.split("\n").slice(-5).join("\n").trim();
  return (
    `ogr2ogr exited with code ${exitCode}. ` +
    `Connection: PG:${redactedPg}. ` +
    `Last stderr lines:\n${tail || "(none)"}`
  );
}

// ---------------------------------------------------------------------------
// Sync service
// ---------------------------------------------------------------------------

export interface SyncResult {
  readonly source: string;
  readonly count: number;
  readonly durationMs: number;
}

interface CadastreSyncServiceContract {
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
  make: Effect.gen(function* () {
    const db = yield* Db;
    const runningRef = yield* Ref.make(false);

    return {
      sync: Effect.fn("CadastreSyncService.sync")(function* (
        explicitPath?: string,
      ) {
        // ----- concurrency guard -----
        const wasRunning = yield* Ref.modify(runningRef, (v) => [v, true]);
        if (wasRunning) {
          return yield* new SyncAlreadyRunningError({
            message:
              "A sync is already in progress; only one local sync may run at a time.",
          });
        }

        const startedAt = Date.now();
        try {
          // ----- source resolution -----
          let source: string;
          try {
            source = resolveSourcePath(explicitPath);
          } catch (err) {
            return yield* new SourceNotFoundError({
              message: err instanceof Error ? err.message : String(err),
            });
          }

          // ----- connection string (with proper PG escaping) -----
          const rawUrl = Redacted.value(
            Redacted.make(
              process.env.DATABASE_URL ??
                "postgres://postgres:postgres@localhost:5432/patch_postgis",
            ),
          );
          const { pgConnString, redacted: redactedPg } =
            parseDatabaseUrl(rawUrl);

          // ----- clean stale staging from previous failed run -----
          yield* wrapDbOps(
            db.execute(sql.raw(`DROP TABLE IF EXISTS ${STAGING_TABLE}`)),
            "Failed to drop stale staging table",
          );

          // ----- create staging with explicit schema contract -----
          yield* wrapDbOps(
            db.execute(sql.raw(CREATE_STAGING_DDL)),
            "Failed to create staging table",
          );

          // ----- run ogr2ogr (append mode – table already exists) -----
          const args = buildOgr2OgrArgs(source, pgConnString);
          let proc: ReturnType<typeof Bun.spawn>;
          try {
            proc = Bun.spawn(["ogr2ogr", ...args], {
              stdout: "pipe",
              stderr: "pipe",
            });
          } catch {
            return yield* new SyncError({
              message:
                "GDAL/ogr2ogr is required but could not be started. " +
                "Please install GDAL >= 3.6 with the OpenFileGDB driver " +
                "and ensure ogr2ogr is available on PATH.",
            });
          }
          const exitCode = yield* Effect.promise(() => proc.exited);
          const stderr = yield* Effect.promise(() => {
            const stream = proc.stderr;
            if (typeof stream !== "number" && stream) {
              return new Response(stream).text();
            }
            return Promise.resolve("");
          });

          if (exitCode !== 0) {
            return yield* new SyncError({
              message: ogr2OgrError(exitCode, stderr, redactedPg),
            });
          }

          // ----- create GiST index on staging AFTER bulk import -----
          yield* wrapDbOps(
            db.execute(sql.raw(CREATE_STAGING_GIST)),
            "Failed to create GiST index on staging table",
          );

          // ----- count imported rows; reject zero-row snapshots -----
          const countResult = yield* wrapDbOps(
            db.execute<Record<string, unknown>>(
              sql.raw(`SELECT COUNT(*)::int AS cnt FROM ${STAGING_TABLE}`),
            ),
            "Failed to count staging rows",
          );
          const count = Number(
            (
              countResult as unknown as {
                readonly rows: readonly { readonly cnt: number }[];
              }
            ).rows[0]?.cnt ?? 0,
          );

          if (count === 0) {
            return yield* new SyncError({
              message: `Staging table ${STAGING_TABLE} contains 0 rows – refusing to promote an empty snapshot. The source FileGDB may be missing the "Lot" layer.`,
            });
          }

          // ----- atomic promotion -----
          // The DROP + RENAME + INDEX-RENAME happen inside a single
          // PostgreSQL transaction.  Other sessions see either the old
          // cadastre_lots table or the fully promoted new one; never an
          // empty or partial table.
          yield* wrapDbOps(
            db.transaction((tx) =>
              Effect.gen(function* () {
                // Dropping the live table also drops its indexes and
                // constraints, freeing the canonical names.
                yield* tx.execute(
                  sql.raw(`DROP TABLE IF EXISTS ${LIVE_TABLE}`),
                );
                yield* tx.execute(
                  sql.raw(
                    `ALTER TABLE ${STAGING_TABLE} RENAME TO ${LIVE_TABLE}`,
                  ),
                );
                // The index still carries the staging suffix; rename it
                // to match the canonical name expected by Drizzle's
                // schema introspection (cadastre_lots_geometry_idx).
                yield* tx.execute(
                  sql.raw(`ALTER INDEX ${STAGING_IDX} RENAME TO ${LIVE_IDX}`),
                );
              }),
            ),
            "Failed to promote staging table to live",
          );

          const durationMs = Date.now() - startedAt;

          return { source, count, durationMs } satisfies SyncResult;
        } finally {
          yield* Ref.set(runningRef, false);
        }
      }),
    };
  }),
}) {}
