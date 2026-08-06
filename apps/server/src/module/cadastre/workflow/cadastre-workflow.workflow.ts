import { Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/unstable/workflow";
import {
  BuildPmtilesActivity,
  DownloadGdbActivity,
  ExtractDownloadLinkActivity,
  ImportPostgisActivity,
  RequestDatasetApiActivity,
  UploadActivity,
  ValidatePromoteActivity,
  VerifyPublishActivity,
  WaitCadastreEmailActivity,
} from "./activity";
import { CadastreEmailIngestionServiceLive } from "./cadastre-email-ingestion.service";

export { ActivityNames, CadastreWorkflowNotImplemented } from "./activity";
export type { ActivityName } from "./activity";
export const CadastreWorkflowInput = Schema.Struct({
  idempotencyKey: Schema.String,
  trigger: Schema.Union([Schema.Literal("scheduled"), Schema.Literal("manual")]),
});
export type CadastreWorkflowInput = typeof CadastreWorkflowInput.Type;

/** Durable workflow definition for the cadastre sync pipeline. */
export const CadastreSyncWorkflow = Workflow.make("CadastreSyncWorkflow", {
  payload: CadastreWorkflowInput,
  success: Schema.String,
  error: Schema.Unknown,
  idempotencyKey: (input) => input.idempotencyKey,
});

const runCadastreSyncWorkflow = Effect.fn("CadastreSyncWorkflow.run")(function* (
  input: CadastreWorkflowInput,
) {
  yield* Effect.logInfo("cadastre activity started: request-dataset-api");
  const exportRequest = yield* RequestDatasetApiActivity.execute;
  yield* Effect.logInfo("cadastre activity started: wait-cadastre-email");
  const cadastreEmail = yield* WaitCadastreEmailActivity.execute({
    requestedAt: exportRequest.requestedAt,
    emailAddress: exportRequest.emailAddress,
  });
  // Keep the ingested row available when extraction accepts workflow inputs.
  yield* Effect.logDebug(`cadastre export email received: ${cadastreEmail.messageId}`);
  yield* Effect.logInfo("cadastre activity started: extract-download-link");
  const downloadUrl = yield* ExtractDownloadLinkActivity({ parsedEmail: cadastreEmail.parsedEmail })
    .execute;
  yield* Effect.logInfo("cadastre activity started: download-gdb");
  yield* DownloadGdbActivity({ downloadUrl }).execute;
  yield* Effect.logInfo("cadastre activity started: import-postgis");
  yield* ImportPostgisActivity.execute;
  yield* Effect.logInfo("cadastre activity started: validate-promote");
  yield* ValidatePromoteActivity.execute;
  yield* Effect.logInfo("cadastre activity started: build-pmtiles");
  yield* BuildPmtilesActivity.execute;
  yield* Effect.logInfo("cadastre activity started: upload");
  yield* UploadActivity.execute;
  yield* Effect.logInfo("cadastre activity started: verify-publish");
  yield* VerifyPublishActivity.execute;
  return input.idempotencyKey;
});

/** Registers the workflow handler and its durable activities. */
export const CadastreSyncWorkflowLive = CadastreSyncWorkflow.toLayer(runCadastreSyncWorkflow).pipe(
  Layer.provide(CadastreEmailIngestionServiceLive),
);
