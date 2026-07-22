import { Schema } from "effect";
export class LotNotFoundError extends Schema.TaggedErrorClass<LotNotFoundError>()(
  "LotNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}

export class CadastreImportError extends Schema.TaggedErrorClass<CadastreImportError>()(
  "CadastreImportError",
  { message: Schema.String },
) {}
