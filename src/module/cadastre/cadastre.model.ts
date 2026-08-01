import { customType, index, pgTable, text } from "drizzle-orm/pg-core";

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

export type CadastreLotRow = typeof cadastreLots.$inferSelect;
