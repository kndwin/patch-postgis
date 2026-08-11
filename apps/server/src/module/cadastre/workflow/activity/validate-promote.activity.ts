import { Effect } from "effect";
import { Activity } from "effect/unstable/workflow";
import { projectActivity } from "../workflow-projection.activity";
import { activityInterruptRetryPolicy } from "./activity-options.activity";
import { CadastreSyncService } from "../../sync/cadastre-sync.service";
import {
  CadastreActivityErrorSchema,
  ValidatePromoteInputSchema,
  ValidatePromoteSuccessSchema,
} from "./validate-promote.activity.schema";
import { CadastreWorkflowPostgisError } from "./cadastre-workflow-error.schema";

export const ValidatePromoteActivity = (input: typeof ValidatePromoteInputSchema.Type) =>
  Activity.make({
    interruptRetryPolicy: activityInterruptRetryPolicy,
    name: "CadastreSyncWorkflow/validate-promote",
    error: CadastreActivityErrorSchema,
    success: ValidatePromoteSuccessSchema,
    execute: projectActivity(
      "validate-promote",
      Effect.fn("CadastreSyncWorkflow.validatePromote.execute")(function* () {
        const service = yield* CadastreSyncService;
        return yield* service
          .validateAndPromote(input)
          .pipe(Effect.mapError((e) => new CadastreWorkflowPostgisError({ message: e.message })));
      })().pipe(
        Effect.mapError(
          (e) =>
            new CadastreWorkflowPostgisError({
              message: e instanceof Error ? e.message : "PostGIS promotion failed",
            }),
        ),
      ),
    ),
  });
