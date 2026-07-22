import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";

const multipolygon4326 = customType<{
  data: string | null;
  driverData: string | null;
}>({
  dataType: () => "geometry(MultiPolygon,4326)",
});

export const cadastreLots = pgTable(
  "cadastre_lots",
  {
    id: text("id").primaryKey(),
    lotNumber: text("lot_number").notNull(),
    geometry: multipolygon4326("geometry"),
  },
  (table) => [
    index("cadastre_lots_geometry_idx").using("gist", table.geometry),
  ],
);

/** Small, cadastre-specific checkpoint. It is deliberately not a workflow table. */
export const cadastreImportCheckpoints = pgTable(
  "cadastre_import_checkpoints",
  {
    source: text("source").primaryKey(),
    /** Index into the immutable OBJECTID snapshot, not an ArcGIS result offset. */
    nextObjectIdIndex: integer("next_object_id_index").notNull().default(0),
    objectIds: integer("object_ids").array().notNull().default([]),
    fetched: integer("fetched").notNull().default(0),
    upserted: integer("upserted").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
  },
);

export type CadastreLotRow = typeof cadastreLots.$inferSelect;
