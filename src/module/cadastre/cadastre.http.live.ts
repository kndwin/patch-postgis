import { Effect } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { AppApi } from "../../platform/http/api.define";
import { CadastreService } from "./cadastre.service";
import { parseArcgisQuery } from "./cadastre.http.schema";

export const CadastreLive = HttpApiBuilder.group(
  AppApi,
  "cadastre",
  (handlers) =>
    handlers
      .handle(
        "getLot",
        Effect.fn("CadastreLive.getLot")(function* ({ params }) {
          const service = yield* CadastreService;
          const { id, lotNumber, geometry } = yield* service
            .getLot({ id: params.id })
            .pipe(
              Effect.catchTags({
                LotNotFoundError: () =>
                  Effect.fail(new HttpApiError.NotFound()),
                EffectDrizzleQueryError: () =>
                  Effect.fail(new HttpApiError.InternalServerError()),
              }),
            );

          return { id, lotNumber, geometry };
        }),
      )
      .handle(
        "getLotTile",
        Effect.fn("CadastreLive.getLotTile")(function* ({ params }) {
          const z = Number(params.z);
          const x = Number(params.x);
          const y = Number(params.y);
          if (
            !Number.isInteger(z) ||
            !Number.isInteger(x) ||
            !Number.isInteger(y) ||
            z < 0 ||
            z > 22 ||
            x < 0 ||
            y < 0 ||
            x >= 2 ** z ||
            y >= 2 ** z
          )
            return yield* new HttpApiError.BadRequest();
          const service = yield* CadastreService;
          return yield* service.getTile({ z, x, y }).pipe(
            Effect.catchTags({
              EffectDrizzleQueryError: () =>
                Effect.fail(new HttpApiError.InternalServerError()),
            }),
          );
        }),
      )
      .handle(
        "getArcgisLot",
        Effect.fn("CadastreLive.getArcgisLot")(function* ({ query }) {
          const parsed = parseArcgisQuery(query);
          if (parsed._tag === "Invalid")
            return yield* new HttpApiError.BadRequest();
          const service = yield* CadastreService;
          const lot = yield* service.getLot({ id: parsed.id }).pipe(
            Effect.catchTags({
              LotNotFoundError: () => Effect.succeed(null),
              EffectDrizzleQueryError: () =>
                Effect.fail(new HttpApiError.InternalServerError()),
            }),
          );
          return {
            type: "FeatureCollection" as const,
            features:
              lot === null
                ? []
                : [
                    {
                      type: "Feature" as const,
                      id: lot.id,
                      geometry: parsed.returnGeometry ? lot.geometry : null,
                      properties: {
                        CADID: lot.id,
                        LotDescription: lot.lotNumber,
                      },
                    },
                  ],
          };
        }),
      ),
);
