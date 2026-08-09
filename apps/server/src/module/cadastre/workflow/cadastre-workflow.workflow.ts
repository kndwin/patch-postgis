import { Cause, DateTime, Effect, Layer, Schema } from "effect";
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
import {
  WorkflowProjectionRepo,
  WorkflowProjectionRepoLive,
  safeActivityError,
} from "./cadastre-workflow.repo";

export { ActivityNames, CadastreWorkflowNotImplemented } from "./activity";
export type { ActivityName } from "./activity";
export const CadastreWorkflowInput = Schema.Struct({
  idempotencyKey: Schema.String,
  trigger: Schema.Union([
    Schema.Literal("scheduled"),
    Schema.Literal("manual"),
    Schema.Literal("recovery"),
  ]),
  source: Schema.optional(
    Schema.Struct({
      objectKey: Schema.String,
      size: Schema.Number,
      etag: Schema.String,
      checksum: Schema.String,
    }),
  ),
  parentExecutionId: Schema.optional(Schema.String),
  retryAttempt: Schema.optional(Schema.Number),
});
export type CadastreWorkflowInput = typeof CadastreWorkflowInput.Type;

const validateInput = (input: CadastreWorkflowInput): Effect.Effect<void, Error> => {
  const recovery = input.trigger === "recovery";
  const hasParent = input.parentExecutionId !== undefined;
  const hasAttempt = input.retryAttempt !== undefined;
  if (recovery !== Boolean(input.source) || recovery !== hasParent || recovery !== hasAttempt)
    return Effect.fail(
      new Error("Recovery inputs must include only source, parent, and retryAttempt"),
    );
  if (!recovery && (hasParent || hasAttempt))
    return Effect.fail(new Error("Normal workflow inputs cannot include recovery fields"));
  if (recovery) {
    const source = input.source;
    const retryAttempt = input.retryAttempt;
    if (
      source === undefined ||
      !/^runs\/[0-9a-f]{64}\/source\/export\.zip$/.test(source.objectKey) ||
      !source.etag.trim() ||
      !Number.isSafeInteger(source.size) ||
      source.size <= 0 ||
      source.size > 2 * 1024 * 1024 * 1024 ||
      !/^[0-9a-f]{32}$/.test(input.parentExecutionId ?? "") ||
      retryAttempt === undefined ||
      !Number.isInteger(retryAttempt) ||
      retryAttempt < 1 ||
      !/^[0-9a-f]{64}$/.test(source.checksum)
    )
      return Effect.fail(new Error("Invalid recovery source metadata"));
  }
  return Effect.void;
};

/** Durable workflow definition for the cadastre sync pipeline. */
export const CadastreSyncWorkflow = Workflow.make("CadastreSyncWorkflow", {
  payload: CadastreWorkflowInput,
  success: Schema.String,
  error: Schema.Unknown,
  idempotencyKey: (input) => input.idempotencyKey,
});

const runCadastreSyncPipeline = Effect.fn("CadastreSyncWorkflow.pipeline")(function* (
  input: CadastreWorkflowInput,
) {
  if (input.source) {
    yield* Effect.logInfo("cadastre recovery using persisted source artifact");
    const imported = yield* ImportPostgisActivity({ source: input.source }).execute;
    const promoted = yield* ValidatePromoteActivity(imported).execute;
    const built = yield* BuildPmtilesActivity(promoted).execute;
    const uploaded = yield* UploadActivity(built).execute;
    const published = yield* VerifyPublishActivity(uploaded).execute;
    return published.snapshotVersion;
  }
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
  const downloadUrl = yield* ExtractDownloadLinkActivity({
    parsedEmail: cadastreEmail.parsedEmail,
  }).execute;
  yield* Effect.logInfo("cadastre activity started: download-gdb");
  const source = yield* DownloadGdbActivity({
    downloadUrl,
    idempotencyKey: input.idempotencyKey,
  }).execute;
  yield* Effect.logInfo(
    `cadastre source artifact captured: ${source.objectKey.length > 0 ? "present" : "missing"}`,
  );
  yield* Effect.logInfo("cadastre activity started: import-postgis");
  const imported = yield* ImportPostgisActivity({ source }).execute;
  yield* Effect.logInfo(
    `cadastre import complete: ${imported.lotCount > 0 ? "present" : "missing"} (${imported.lotCount})`,
  );
  yield* Effect.logInfo("cadastre activity started: validate-promote");
  const promoted = yield* ValidatePromoteActivity(imported).execute;
  yield* Effect.logInfo(
    `cadastre promotion complete: ${promoted.lotCount > 0 ? "present" : "missing"} (${promoted.lotCount})`,
  );
  yield* Effect.logInfo("cadastre activity started: build-pmtiles");
  const built = yield* BuildPmtilesActivity(promoted).execute;
  yield* Effect.logInfo("cadastre activity started: upload");
  const uploaded = yield* UploadActivity(built).execute;
  yield* Effect.logInfo("cadastre activity started: verify-publish");
  const published = yield* VerifyPublishActivity(uploaded).execute;
  yield* Effect.logInfo("cadastre publication complete");
  return published.snapshotVersion;
});

const runCadastreSyncWorkflow = Effect.fn("CadastreSyncWorkflow.run")(function* (
  input: CadastreWorkflowInput,
  executionId: string,
) {
  const repo = yield* WorkflowProjectionRepo;
  yield* validateInput(input);
  const startedAt = yield* DateTime.now;
  yield* repo.startWorkflow({
    id: executionId,
    trigger: input.trigger,
    idempotencyKey: input.idempotencyKey,
    startedAt: DateTime.toDate(startedAt),
    parentExecutionId: input.parentExecutionId,
    retryAttempt: input.retryAttempt,
  });
  if (input.source)
    yield* repo.saveSourceArtifact({
      executionId,
      ...input.source,
      createdAt: DateTime.toDate(startedAt),
    });
  const steps = yield* runCadastreSyncPipeline(input).pipe(
    Effect.matchCauseEffect({
      onSuccess: (value) =>
        Effect.fn("CadastreSyncWorkflow.succeed")(function* () {
          const finishedAt = yield* DateTime.now;
          const current = yield* repo.detail(executionId);
          if (current)
            yield* repo.updateWorkflow({
              id: executionId,
              status: "succeeded",
              steps: current.steps ?? [],
              finishedAt: DateTime.toDate(finishedAt),
            });
          return value;
        })(),
      onFailure: (cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.fn("CadastreSyncWorkflow.fail")(function* () {
              const finishedAt = yield* DateTime.now;
              const current = yield* repo.detail(executionId);
              if (current)
                yield* repo.updateWorkflow({
                  id: executionId,
                  status: "failed",
                  steps: current.steps ?? [],
                  finishedAt: DateTime.toDate(finishedAt),
                  error: safeActivityError(),
                  failedStep: current.failedStep,
                });
              return yield* Effect.failCause(cause);
            })(),
    }),
  );
  return steps;
});

/** Registers the workflow handler and its durable activities. */
export const CadastreSyncWorkflowLive = CadastreSyncWorkflow.toLayer(runCadastreSyncWorkflow).pipe(
  Layer.provide(CadastreEmailIngestionServiceLive),
  Layer.provide(WorkflowProjectionRepoLive),
);
