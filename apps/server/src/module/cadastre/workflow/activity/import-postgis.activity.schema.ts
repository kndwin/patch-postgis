import { Schema } from "effect";
import { DownloadGdbSuccessSchema } from "./download-gdb.activity.schema";
export const ImportPostgisInputSchema = Schema.Struct({
  source: DownloadGdbSuccessSchema,
});
export const ImportPostgisSuccessSchema = Schema.Struct({
  source: DownloadGdbSuccessSchema,
  runHash: Schema.String,
  stagingTable: Schema.String,
  stagingIndex: Schema.String,
  lotCount: Schema.Number,
});
export type ImportPostgisInput = typeof ImportPostgisInputSchema.Type;
export type ImportPostgisSuccess = typeof ImportPostgisSuccessSchema.Type;
export { CadastreActivityErrorSchema } from "./cadastre-workflow-error.schema";
