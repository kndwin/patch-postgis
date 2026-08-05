import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiError, HttpApiGroup } from "effect/unstable/httpapi";
import {
  ArcgisFeatureCollectionSchema,
  ArcgisQuerySchema,
  CadastreEmailIngestionPayloadSchema,
  LotParamsSchema,
  LotResponseSchema,
  SnapshotResponseSchema,
  SyncRunResponseSchema,
  TileParamsSchema,
  TileResponseSchema,
} from "./cadastre.schema";

export const LotErrorSchemas = [
  HttpApiError.NotFoundNoContent,
  HttpApiError.InternalServerErrorNoContent,
] as const;
export const TileErrorSchemas = [
  HttpApiError.BadRequestNoContent,
  HttpApiError.InternalServerErrorNoContent,
] as const;

const internalError = [HttpApiError.InternalServerErrorNoContent] as const;

export const cadastreGroup = HttpApiGroup.make("cadastre").add(
  HttpApiEndpoint.post("ingestEmail", "/email-ingestions", {
    headers: { authorization: Schema.String },
    payload: CadastreEmailIngestionPayloadSchema,
    success: Schema.Struct({ messageId: Schema.String, created: Schema.Boolean }),
    error: [
      HttpApiError.BadRequestNoContent,
      HttpApiError.UnauthorizedNoContent,
      HttpApiError.InternalServerErrorNoContent,
    ],
  }),
  HttpApiEndpoint.get("getLot", "/lots/:id", {
    params: LotParamsSchema,
    success: LotResponseSchema,
    error: LotErrorSchemas,
  }),
  HttpApiEndpoint.get("getLotTile", "/tiles/:z/:x/:y.mvt", {
    disableCodecs: true,
    params: TileParamsSchema,
    success: TileResponseSchema,
    error: TileErrorSchemas,
  }),
  HttpApiEndpoint.get(
    "getArcgisLot",
    "/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query",
    {
      query: ArcgisQuerySchema,
      success: ArcgisFeatureCollectionSchema,
      error: [HttpApiError.BadRequestNoContent, HttpApiError.InternalServerErrorNoContent],
    },
  ),
  HttpApiEndpoint.get("getCurrentSnapshot", "/snapshots/current", {
    success: Schema.NullOr(SnapshotResponseSchema),
    error: internalError,
  }),
  HttpApiEndpoint.get("getSyncRuns", "/sync/runs", {
    query: {},
    success: Schema.Array(SyncRunResponseSchema),
    error: internalError,
  }),
);
