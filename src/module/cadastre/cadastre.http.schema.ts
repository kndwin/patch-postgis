import { Schema } from "effect";
import { HttpApiError, HttpApiSchema } from "effect/unstable/httpapi";
import { CadastreLotSchema } from "./cadastre.model.schema";
import { MultiPolygonGeometry } from "./cadastre.geometry";

// GeoJSON's MultiPolygon coordinates are four levels deep:
// polygons -> rings -> positions -> coordinates. The database stores the
// geometry as PostGIS, but the bridge exposes the standard GeoJSON shape.
export const MultiPolygonGeometrySchema = Schema.Struct({
  type: Schema.Literal("MultiPolygon"),
  coordinates: Schema.Array(
    Schema.Array(Schema.Array(Schema.Tuple([Schema.Number, Schema.Number]))),
  ),
}) satisfies Schema.Schema<MultiPolygonGeometry>;

export const LotResponseSchema = Schema.Struct({
  id: CadastreLotSchema.fields.id,
  lotNumber: CadastreLotSchema.fields.lotNumber,
  geometry: Schema.NullOr(MultiPolygonGeometrySchema),
});

export const LotParamsSchema = { id: Schema.String };
export const LotErrorSchemas = [
  HttpApiError.NotFoundNoContent,
  HttpApiError.InternalServerErrorNoContent,
] as const;

export const TileParamsSchema = {
  z: Schema.String,
  x: Schema.String,
  y: Schema.String,
};

export const TileResponseSchema = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({
    contentType: "application/vnd.mapbox-vector-tile",
  }),
);

export const TileErrorSchemas = [
  HttpApiError.BadRequestNoContent,
  HttpApiError.InternalServerErrorNoContent,
] as const;
