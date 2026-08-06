import { desc, eq } from "drizzle-orm";
import { Effect, Context, Config } from "effect";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Db } from "../../../platform/database/client";
import { cadastreSnapshots, cadastreSyncRuns } from "./cadastre-sync.model";
import {
  encodedPublicTileUrl,
  normalizeTileBaseUrl,
} from "../../../platform/cadastre/pmtiles.boundary";

export type SnapshotStatus = {
  readonly version: string;
  readonly source: string;
  readonly lotCount: number;
  readonly importedAt: string;
  readonly pmtilesStatus: string;
  readonly pmtilesUrl: string | null;
};

export type SyncRunStatus = {
  readonly id: string;
  readonly status: string;
  readonly phase: string;
  readonly source: string | null;
  readonly snapshotVersion: string | null;
  readonly progress: number | null;
  readonly message: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
};

interface CadastreStatusServiceContract {
  readonly currentSnapshot: () => Effect.Effect<SnapshotStatus | null, EffectDrizzleQueryError>;
  readonly runs: () => Effect.Effect<readonly SyncRunStatus[], EffectDrizzleQueryError>;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export class CadastreStatusService extends Context.Service<
  CadastreStatusService,
  CadastreStatusServiceContract
>()("CadastreStatusService", {
  make: Effect.fn("CadastreStatusService.make")(function* () {
    const db = yield* Db;
    const configuredTileUrl = yield* Config.string("CADASTRE_TILE_URL").pipe(
      Config.withDefault(""),
    );
    const tileUrl = normalizeTileBaseUrl(configuredTileUrl);
    return {
      currentSnapshot: Effect.fn("CadastreStatusService.currentSnapshot")(function* () {
        const row = yield* db
          .select()
          .from(cadastreSnapshots)
          .where(eq(cadastreSnapshots.pmtilesStatus, "published"))
          .orderBy(desc(cadastreSnapshots.importedAt))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));
        return row === undefined
          ? null
          : {
              version: row.version,
              source: "NSW Spatial Services",
              lotCount: row.lotCount,
              importedAt: row.importedAt.toISOString(),
              pmtilesStatus: row.pmtilesStatus,
              pmtilesUrl:
                row.pmtilesStatus === "published" &&
                row.pmtilesObjectKey !== null &&
                tileUrl !== null
                  ? encodedPublicTileUrl(tileUrl, row.pmtilesObjectKey)
                  : null,
            };
      }),
      runs: Effect.fn("CadastreStatusService.runs")(function* () {
        const rows = yield* db
          .select()
          .from(cadastreSyncRuns)
          .orderBy(desc(cadastreSyncRuns.startedAt));
        return rows.map((row) => ({
          id: row.id,
          status: row.status,
          phase: row.phase,
          source: row.source,
          snapshotVersion: row.snapshotVersion,
          progress: null,
          message: null,
          error: row.error,
          startedAt: row.startedAt.toISOString(),
          finishedAt: iso(row.finishedAt),
        }));
      }),
    };
  })(),
}) {}
