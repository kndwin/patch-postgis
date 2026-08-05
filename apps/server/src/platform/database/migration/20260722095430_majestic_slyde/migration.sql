CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE "cadastre_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"lot_number" text NOT NULL,
	"geometry" geometry(MultiPolygon,4326)
);

CREATE INDEX "cadastre_lots_geometry_idx" ON "cadastre_lots" USING gist ("geometry");
