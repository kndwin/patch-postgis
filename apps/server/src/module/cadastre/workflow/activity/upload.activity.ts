import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { CadastreActivityErrorSchema } from "./upload.activity.schema";
import { CadastreWorkflowNotImplemented } from "./cadastre-workflow-error.schema";

/** Explicit mock boundary; no object storage upload occurs. */
export const UploadActivity = Activity.make({
  name: "CadastreSyncWorkflow/upload",
  error: CadastreActivityErrorSchema,
  execute: Effect.fail(
    new CadastreWorkflowNotImplemented({
      activity: "upload",
      message: "Activity is not implemented: upload",
    }),
  ),
});
