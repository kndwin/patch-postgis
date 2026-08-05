import { Schema } from "effect";

export { CadastreActivityErrorSchema } from "./cadastre-workflow-error.schema";

export const ProviderResponseSchema = Schema.Struct({
  requestId: Schema.optional(Schema.String),
  jobId: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
});
