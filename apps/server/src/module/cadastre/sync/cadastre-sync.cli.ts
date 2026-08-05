import { BunRuntime, BunServices } from "@effect/platform-bun";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import { Effect, Layer, Option } from "effect";
import { DbLive } from "../../../platform/database/client";
import { CadastreSyncService } from "./cadastre-sync.service";

const SyncLive = Layer.effect(CadastreSyncService, CadastreSyncService.make).pipe(
  Layer.provide(DbLive),
);

const syncCommand = Command.make(
  "sync",
  { source: Argument.string("source").pipe(Argument.optional) },
  ({ source }) =>
    Effect.fn("syncCommand")(function* () {
      const service = yield* CadastreSyncService;
      const result = yield* service.sync(Option.getOrUndefined(source));
      yield* Effect.log(`Source:     ${result.source}`);
      yield* Effect.log(`Lots:       ${result.count}`);
      yield* Effect.log(`Duration:   ${result.durationMs}ms`);
    })(),
);

const program = Command.run(syncCommand, { version: "0.1.0" });
// BunRuntime supplies the CLI environment at runtime; the beta CLI types do
// not reduce that environment after the application layer is provided.
const runnable = Effect.provide(program, Layer.merge(SyncLive, BunServices.layer)) as Effect.Effect<
  void,
  unknown,
  never
>;
BunRuntime.runMain(runnable);
