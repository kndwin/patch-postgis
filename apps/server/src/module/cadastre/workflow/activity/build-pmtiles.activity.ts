import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { CadastreActivityErrorSchema } from "./build-pmtiles.activity.schema";
import { CadastreWorkflowNotImplemented } from "./cadastre-workflow-error.schema";

/** Explicit mock boundary; no PMTiles build occurs. */
export const BuildPmtilesActivity = Activity.make({
  name: "CadastreSyncWorkflow/build-pmtiles",
  error: CadastreActivityErrorSchema,
  execute: Effect.fail(
    new CadastreWorkflowNotImplemented({
      activity: "build-pmtiles",
      message: "Activity is not implemented: build-pmtiles",
    }),
  ),
});
