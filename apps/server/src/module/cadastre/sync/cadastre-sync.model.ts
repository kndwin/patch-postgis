import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const cadastreSnapshots = pgTable(
  "cadastre_snapshots",
  {
    version: text("version").primaryKey(),
    source: text("source").notNull(),
    lotCount: integer("lot_count").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    pmtilesStatus: text("pmtiles_status").notNull(),
    pmtilesUrl: text("pmtiles_url"),
  },
  (table) => [index("cadastre_snapshots_imported_at_idx").on(table.importedAt)],
);

export const cadastreSyncRuns = pgTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull(),
    phase: text("phase").notNull(),
    source: text("source"),
    snapshotVersion: text("snapshot_version"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    index("cadastre_sync_runs_started_at_idx").on(table.startedAt),
    index("cadastre_sync_runs_status_idx").on(table.status),
  ],
);

export type CadastreSnapshot = typeof cadastreSnapshots.$inferSelect;
export type CadastreSyncRun = typeof cadastreSyncRuns.$inferSelect;
