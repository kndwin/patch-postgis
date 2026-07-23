import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiError,
} from "effect/unstable/httpapi";
import {
  LotErrorSchemas,
  LotParamsSchema,
  LotResponseSchema,
  TileErrorSchemas,
  TileParamsSchema,
  TileResponseSchema,
  ArcgisQuerySchema,
  ArcgisFeatureCollectionSchema,
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

const getArcgisLot = HttpApiEndpoint.get(
  "getArcgisLot",
  "/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query",
  {
    query: ArcgisQuerySchema,
    success: ArcgisFeatureCollectionSchema,
    error: [
      HttpApiError.BadRequestNoContent,
      HttpApiError.InternalServerErrorNoContent,
    ],
  },
);

export const cadastreGroup = HttpApiGroup.make("cadastre").add(
  getLot,
  getLotTile,
  getArcgisLot,
);
