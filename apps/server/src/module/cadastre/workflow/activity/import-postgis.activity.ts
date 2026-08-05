import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { CadastreActivityErrorSchema } from "./import-postgis.activity.schema";
import { CadastreWorkflowNotImplemented } from "./cadastre-workflow-error.schema";

/** Explicit mock boundary; no PostGIS import occurs. */
export const ImportPostgisActivity = Activity.make({
  name: "CadastreSyncWorkflow/import-postgis",
  error: CadastreActivityErrorSchema,
  execute: Effect.fail(
    new CadastreWorkflowNotImplemented({
      activity: "import-postgis",
      message: "Activity is not implemented: import-postgis",
    }),
  ),
});
