import { Context, Effect } from "effect";
import { eq } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Db } from "../../platform/db/client";
import { cadastreLots } from "./cadastre.model";
import type { CadastreLotRow } from "./cadastre.model";
import { LotNotFoundError } from "./cadastre.schema";

type LotResponse = Pick<CadastreLotRow, "id" | "lotNumber">;

interface CadastreServiceContract {
  readonly getLot: (params: {
    readonly id: string;
  }) => Effect.Effect<LotResponse, LotNotFoundError | EffectDrizzleQueryError>;
}

export class CadastreService extends Context.Service<
  CadastreService,
  CadastreServiceContract
>()("CadastreService", {
  make: Effect.gen(function* () {
    const db = yield* Db;

    return {
      getLot: Effect.fn("CadastreService.getLot")(function* ({
        id,
      }: {
        readonly id: string;
      }) {
        const lot = yield* db
          .select({
            id: cadastreLots.id,
            lotNumber: cadastreLots.lotNumber,
          })
          .from(cadastreLots)
          .where(eq(cadastreLots.id, id))
          .limit(1)
          .pipe(Effect.map((rows) => rows[0]));

        if (lot === undefined) {
          return yield* new LotNotFoundError({
            id,
            message: `Lot ${id} was not found`,
          });
        }

        return lot;
      }),
    };
  }),
}) {}
