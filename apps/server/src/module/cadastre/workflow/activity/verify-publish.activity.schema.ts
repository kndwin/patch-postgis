import { Schema } from "effect";
import { UploadSuccessSchema } from "./upload.activity.schema";
export const VerifyPublishInputSchema = UploadSuccessSchema;
export const VerifyPublishSuccessSchema = Schema.Struct({
  snapshotVersion: Schema.String,
  objectKey: Schema.String,
  size: Schema.Number,
  etag: Schema.String,
  checksum: Schema.String,
  published: Schema.Literal(true),
});
export { CadastreActivityErrorSchema } from "./cadastre-workflow-error.schema";
