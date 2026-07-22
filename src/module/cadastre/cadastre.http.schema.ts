import { Schema } from "effect";
import { HttpApiError } from "effect/unstable/httpapi";
import { CadastreLotSchema } from "./cadastre.model.schema";

export const LotResponseSchema = Schema.Struct({
  id: CadastreLotSchema.fields.id,
  lotNumber: CadastreLotSchema.fields.lotNumber,
});

export const LotParamsSchema = { id: Schema.String };
export const LotErrorSchemas = [
  HttpApiError.NotFoundNoContent,
  HttpApiError.InternalServerErrorNoContent,
] as const;
