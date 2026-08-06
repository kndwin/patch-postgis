import { Schema } from "effect";

export const DownloadGdbInputSchema = Schema.Struct({
  downloadUrl: Schema.String,
});
export type DownloadGdbInput = typeof DownloadGdbInputSchema.Type;

export { CadastreActivityErrorSchema } from "./cadastre-workflow-error.schema";
