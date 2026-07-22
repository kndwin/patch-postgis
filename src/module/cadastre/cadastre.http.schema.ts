import { Schema } from "effect";
import { HttpApiError, HttpApiSchema } from "effect/unstable/httpapi";
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

export const TileParamsSchema = {
  z: Schema.String,
  x: Schema.String,
  y: Schema.String,
};

export const TileResponseSchema = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({
    contentType: "application/vnd.mapbox-vector-tile",
  }),
);

export const TileErrorSchemas = [
  HttpApiError.BadRequestNoContent,
  HttpApiError.InternalServerErrorNoContent,
] as const;
