import { BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer } from "effect";
import { DbLive } from "../../../platform/db/client";
import { CadastreSyncService } from "./cadastre.sync.service";

// First non-flag argument is treated as the explicit source path.
const explicitPath: string | undefined = process.argv
  .slice(2)
  .find((a) => !a.startsWith("-"));

const program = Effect.gen(function* () {
  const service = yield* CadastreSyncService;
  const result = yield* service.sync(explicitPath);

  console.log(`Source:     ${result.source}`);
  console.log(`Lots:       ${result.count}`);
  console.log(`Duration:   ${result.durationMs}ms`);
});

const SyncLive = Layer.effect(
  CadastreSyncService,
  CadastreSyncService.make,
).pipe(Layer.provide(DbLive));

// Provide the layer so the program has no remaining context.  Effect 4.0
// beta's type inference does not always collapse deeply-nested Layer chains to
// `never`, so we widen the context slot so `BunRuntime.runMain` accepts it.
const layeredProgram = Effect.provide(program, SyncLive) as Effect.Effect<
  void,
  never,
  never
>;

const main = Effect.gen(function* () {
  const exit = yield* Effect.exit(layeredProgram);
  if (Exit.isFailure(exit)) {
    const pretty = Cause.pretty(exit.cause);
    console.error(pretty);
    process.exitCode = 1;
  }
});

BunRuntime.runMain(main);
