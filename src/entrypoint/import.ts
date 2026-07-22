import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { CadastreService } from "../module/cadastre/cadastre.service";
import { DbLive } from "../platform/db/client";

const program = Effect.gen(function* () {
  const counts = yield* (yield* CadastreService).importSurryHills();
  yield* Effect.log(
    `Imported ${counts.upserted}/${counts.fetched} Surry Hills NSW parcels (${counts.skipped} skipped: missing lot number)`,
  );
}).pipe(
  Effect.tapError((error) => Effect.logError(error)),
  Effect.provide(
    Layer.effect(CadastreService)(CadastreService.make).pipe(
      Layer.provide(DbLive),
    ),
  ),
);

BunRuntime.runMain(program);
