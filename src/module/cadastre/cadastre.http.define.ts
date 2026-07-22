import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  LotErrorSchemas,
  LotParamsSchema,
  LotResponseSchema,
  TileErrorSchemas,
  TileParamsSchema,
  TileResponseSchema,
} from "./cadastre.http.schema";

const getLot = HttpApiEndpoint.get("getLot", "/lots/:id", {
  params: LotParamsSchema,
  success: LotResponseSchema,
  error: LotErrorSchemas,
});

const getLotTile = HttpApiEndpoint.get("getLotTile", "/tiles/:z/:x/:y.mvt", {
  disableCodecs: true,
  params: TileParamsSchema,
  success: TileResponseSchema,
  error: TileErrorSchemas,
});

export const cadastreGroup = HttpApiGroup.make("cadastre").add(
  getLot,
  getLotTile,
);
