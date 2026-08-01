import { Schema } from "effect";
export class LotNotFoundError extends Schema.TaggedErrorClass<LotNotFoundError>()(
  "LotNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}
