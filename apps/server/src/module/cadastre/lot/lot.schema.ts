import { createSelectSchema } from "drizzle-orm/effect-schema";
import { cadastreLots } from "./lot.model";

// Derive the model schema from the Drizzle table. Geometry is not exposed by
// the HTTP DTO, but remains part of the model schema for other consumers.
export const CadastreLotSchema = createSelectSchema(cadastreLots);
import { Schema } from "effect";
export class LotNotFoundError extends Schema.TaggedErrorClass<LotNotFoundError>()(
  "LotNotFoundError",
  { id: Schema.String, message: Schema.String },
) {}
