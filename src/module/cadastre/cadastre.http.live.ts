import { Effect } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { AppApi } from "../../platform/http/api.define";
import { CadastreService } from "./cadastre.service";

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
      ),
);
