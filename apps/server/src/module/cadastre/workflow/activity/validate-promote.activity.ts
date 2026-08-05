import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { CadastreActivityErrorSchema } from "./validate-promote.activity.schema";
import { CadastreWorkflowNotImplemented } from "./cadastre-workflow-error.schema";

/** Explicit mock boundary; no validation or promotion occurs. */
export const ValidatePromoteActivity = Activity.make({
  name: "CadastreSyncWorkflow/validate-promote",
  error: CadastreActivityErrorSchema,
  execute: Effect.fail(
    new CadastreWorkflowNotImplemented({
      activity: "validate-promote",
      message: "Activity is not implemented: validate-promote",
    }),
  ),
});
