import { Schema } from "effect";
import { ImportPostgisSuccessSchema } from "./import-postgis.activity.schema";
export const ValidatePromoteInputSchema = ImportPostgisSuccessSchema;
export const ValidatePromoteSuccessSchema = Schema.Struct({
  source: ImportPostgisSuccessSchema.fields.source,
  runHash: Schema.String,
  snapshotVersion: Schema.String,
  liveTable: Schema.Literal("cadastre_lots"),
  lotCount: Schema.Number,
});
export { CadastreActivityErrorSchema } from "./cadastre-workflow-error.schema";
