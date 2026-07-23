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

export const ArcgisQuerySchema = {
  where: Schema.String,
  outFields: Schema.optional(Schema.String),
  returnGeometry: Schema.String,
  f: Schema.String,
  outSR: Schema.String,
};

type ArcgisQuery = {
  readonly where: string;
  readonly outFields?: string;
  readonly returnGeometry: string;
  readonly f: string;
  readonly outSR: string;
};

export type ParsedArcgisQuery =
  | {
      readonly _tag: "Valid";
      readonly id: string;
      readonly returnGeometry: boolean;
    }
  | { readonly _tag: "Invalid" };

/** Deliberately narrow ArcGIS compatibility surface; never pass a where clause to SQL. */
export const parseArcgisQuery = (query: ArcgisQuery): ParsedArcgisQuery => {
  const match = /^CADID=([A-Za-z0-9_-]+)$/.exec(query.where);
  if (
    match === null ||
    (query.outFields !== undefined && query.outFields !== "*") ||
    query.f !== "geojson" ||
    query.outSR !== "4326" ||
    (query.returnGeometry !== "true" && query.returnGeometry !== "false")
  )
    return { _tag: "Invalid" };
  return {
    _tag: "Valid",
    id: match[1],
    returnGeometry: query.returnGeometry === "true",
  };
};

export const ArcgisGeometrySchema = Schema.NullOr(MultiPolygonGeometrySchema);
export const ArcgisFeatureSchema = Schema.Struct({
  type: Schema.Literal("Feature"),
  id: Schema.String,
  geometry: ArcgisGeometrySchema,
  properties: Schema.Struct({
    CADID: Schema.String,
    LotDescription: Schema.String,
  }),
});
export const ArcgisFeatureCollectionSchema = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(ArcgisFeatureSchema),
});
