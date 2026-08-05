/**
 * Local/testing fixture for the future PMTiles pipeline.
 *
 * This intentionally does not download, build, or upload anything. Keeping the
 * command in the source tree makes the eventual Effect services explicit while
 * the product remains status-only.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import * as Argument from "effect/unstable/cli/Argument";
import * as Command from "effect/unstable/cli/Command";
import { Effect } from "effect";

const command = Command.make(
  "build-pmtiles",
  {
    source: Argument.string("source"),
    version: Argument.string("version"),
  },
  ({ source, version }) =>
    Effect.log(
      `PMTiles fixture only: would process ${source} as snapshot ${version}; no work was performed.`,
    ),
);

const runnable = Effect.provide(
  Command.run(command, { version: "0.1.0" }),
  BunServices.layer,
) as Effect.Effect<void, unknown, never>;
BunRuntime.runMain(runnable);
