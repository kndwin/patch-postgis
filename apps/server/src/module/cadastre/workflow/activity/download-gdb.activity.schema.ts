import { Schema } from "effect";

export const DownloadGdbInputSchema = Schema.Struct({
  downloadUrl: Schema.String,
  idempotencyKey: Schema.String,
});
export type DownloadGdbInput = typeof DownloadGdbInputSchema.Type;
export const DownloadGdbSuccessSchema = Schema.Struct({
  objectKey: Schema.String,
  size: Schema.Number,
  etag: Schema.String,
  checksum: Schema.String,
});
export type DownloadGdbSuccess = typeof DownloadGdbSuccessSchema.Type;

export { CadastreActivityErrorSchema } from "./cadastre-workflow-error.schema";
