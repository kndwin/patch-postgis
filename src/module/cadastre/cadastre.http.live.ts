import { Effect } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { AppApi } from "../../platform/http/api.define";
import { CadastreService } from "./cadastre.service";

export const CadastreLive = HttpApiBuilder.group(
  AppApi,
  "cadastre",
  (handlers) =>
    handlers.handle(
      "getLot",
      Effect.fn("CadastreLive.getLot")(function* ({ params }) {
        const service = yield* CadastreService;
        const { id, lotNumber } = yield* service.getLot({ id: params.id }).pipe(
          Effect.catchTags({
            LotNotFoundError: () => Effect.fail(new HttpApiError.NotFound()),
            EffectDrizzleQueryError: () =>
              Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );

        return { id, lotNumber };
      }),
    ),
);
