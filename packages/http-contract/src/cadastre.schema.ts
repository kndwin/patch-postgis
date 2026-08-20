import { Schema } from "effect";
import { HttpApiSchema } from "effect/unstable/httpapi";

export const MultiPolygonGeometrySchema = Schema.Struct({
  type: Schema.Literal("MultiPolygon"),
  coordinates: Schema.Array(
    Schema.Array(Schema.Array(Schema.Tuple([Schema.Number, Schema.Number]))),
  ),
});

export const LotParamsSchema = { id: Schema.String };
export const LotResponseSchema = Schema.Struct({
  id: Schema.String,
  lotNumber: Schema.String,
  geometry: Schema.NullOr(MultiPolygonGeometrySchema),
});

export const TileParamsSchema = { z: Schema.String, x: Schema.String, y: Schema.String };
export const TileResponseSchema = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/vnd.mapbox-vector-tile" }),
);

export const ArcgisQuerySchema = {
  where: Schema.String,
  outFields: Schema.optional(Schema.String),
  returnGeometry: Schema.String,
  f: Schema.String,
  outSR: Schema.String,
};
export const ArcgisGeometrySchema = Schema.NullOr(MultiPolygonGeometrySchema);
export const ArcgisFeatureSchema = Schema.Struct({
  type: Schema.Literal("Feature"),
  id: Schema.String,
  geometry: ArcgisGeometrySchema,
  properties: Schema.Struct({ CADID: Schema.String, LotDescription: Schema.String }),
});
export const ArcgisFeatureCollectionSchema = Schema.Struct({
  type: Schema.Literal("FeatureCollection"),
  features: Schema.Array(ArcgisFeatureSchema),
});

export const SnapshotResponseSchema = Schema.Struct({
  version: Schema.String,
  source: Schema.String,
  lotCount: Schema.Number,
  importedAt: Schema.String,
  pmtilesStatus: Schema.String,
  pmtilesUrl: Schema.NullOr(Schema.String),
});
export const SyncRunResponseSchema = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  phase: Schema.String,
  source: Schema.NullOr(Schema.String),
  snapshotVersion: Schema.NullOr(Schema.String),
  progress: Schema.NullOr(Schema.Number),
  message: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});

export const CadastreEmailIngestionPayloadSchema = Schema.Struct({
  messageId: Schema.String,
  envelope: Schema.Struct({ from: Schema.String, to: Schema.String }),
  subject: Schema.NullOr(Schema.String),
  receivedAt: Schema.String,
  rawR2Key: Schema.String,
  metadataR2Key: Schema.String,
  metadata: Schema.String,
  parsedEmail: Schema.String,
});
export const CadastreEmailIngestionPayloadJsonSchema = Schema.fromJsonString(
  CadastreEmailIngestionPayloadSchema,
);

export type Snapshot = Schema.Schema.Type<typeof SnapshotResponseSchema>;
export type SyncRun = Schema.Schema.Type<typeof SyncRunResponseSchema>;
