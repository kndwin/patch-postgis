import { createSelectSchema } from "drizzle-orm/effect-schema";
import { cadastreLots } from "./cadastre.model";

// Derive the model schema from the Drizzle table. Geometry is not exposed by
// the HTTP DTO, but remains part of the model schema for other consumers.
export const CadastreLotSchema = createSelectSchema(cadastreLots);
