import { BunRuntime } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { CadastreService } from "../module/cadastre/cadastre.service";
import { DbLive } from "../platform/db/client";

const program = Effect.gen(function* () {
  yield* Effect.log(
    "WARNING: this imports the documented Sydney + Western Sydney cadastre area; use import for the Surry Hills smoke test.",
  );
  const counts = yield* (yield* CadastreService).importSydneyInitial();
  yield* Effect.log(
    `Imported Sydney + Western Sydney cadastre: ${counts.upserted}/${counts.fetched} parcels (${counts.skipped} skipped; resumed from ${counts.resumedFrom})`,
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
