import { Schema } from "effect";
import { ValidatePromoteSuccessSchema } from "./validate-promote.activity.schema";

export const BuildPmtilesInputSchema = ValidatePromoteSuccessSchema;
export const BuildPmtilesSuccessSchema = Schema.Struct({
  source: ValidatePromoteSuccessSchema.fields.source,
  runHash: Schema.String,
  snapshotVersion: Schema.String,
  lotCount: Schema.Number,
  objectKey: Schema.String,
  size: Schema.Number,
  etag: Schema.String,
  checksum: Schema.String,
  minZoom: Schema.Literal(14),
  maxZoom: Schema.Literal(18),
  layer: Schema.Literal("lots"),
  tileType: Schema.Literal("mvt"),
});
export { CadastreActivityErrorSchema } from "./cadastre-workflow-error.schema";
