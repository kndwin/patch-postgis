import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { CadastreActivityErrorSchema } from "./extract-download-link.activity.schema";
import { CadastreWorkflowNotImplemented } from "./cadastre-workflow-error.schema";

/** Explicit mock boundary; no email parsing occurs. */
export const ExtractDownloadLinkActivity = Activity.make({
  name: "CadastreSyncWorkflow/extract-download-link",
  error: CadastreActivityErrorSchema,
  execute: Effect.fail(
    new CadastreWorkflowNotImplemented({
      activity: "extract-download-link",
      message: "Activity is not implemented: extract-download-link",
    }),
  ),
});
