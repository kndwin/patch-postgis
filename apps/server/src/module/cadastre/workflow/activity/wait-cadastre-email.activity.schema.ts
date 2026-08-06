import { Schema } from "effect";

export class CadastreEmailTimeoutError extends Schema.TaggedErrorClass<CadastreEmailTimeoutError>()(
  "CadastreEmailTimeoutError",
  { message: Schema.String, attempts: Schema.Number },
) {}

export class CadastreEmailLookupError extends Schema.TaggedErrorClass<CadastreEmailLookupError>()(
  "CadastreEmailLookupError",
  { message: Schema.String },
) {}

export const WaitCadastreEmailSuccessSchema = Schema.Struct({
  messageId: Schema.String,
  receivedAt: Schema.String,
  parsedEmail: Schema.Unknown,
});

export const WaitCadastreEmailErrorSchema = Schema.Union([CadastreEmailTimeoutError]);

export const WaitCadastreEmailLookupResultSchema = Schema.NullOr(WaitCadastreEmailSuccessSchema);

export const WaitCadastreEmailLookupErrorSchema = Schema.Union([CadastreEmailLookupError]);
