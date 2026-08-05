import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { CadastreActivityErrorSchema } from "./verify-publish.activity.schema";
import { CadastreWorkflowNotImplemented } from "./cadastre-workflow-error.schema";

/** Explicit mock boundary; no publication verification occurs. */
export const VerifyPublishActivity = Activity.make({
  name: "CadastreSyncWorkflow/verify-publish",
  error: CadastreActivityErrorSchema,
  execute: Effect.fail(
    new CadastreWorkflowNotImplemented({
      activity: "verify-publish",
      message: "Activity is not implemented: verify-publish",
    }),
  ),
});
