import { Config, DateTime, Effect } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { AppApi } from "@patch/http-contract";
import { WorkflowProjection } from "./cadastre-workflow.service";
import { CadastreSyncWorkflow } from "./cadastre-workflow.workflow";
import { WorkflowProjectionRepo } from "./cadastre-workflow.repo";

const boundedLimit = (value: string | undefined) =>
  Math.min(100, Math.max(1, Number(value ?? 25) || 25));
export const WorkflowLive = HttpApiBuilder.group(AppApi, "workflow", (handlers) =>
  handlers
    .handle(
      "triggerCadastreSync",
      Effect.fn("WorkflowLive.triggerCadastreSync")(function* ({ headers, payload }) {
        const expected = yield* Config.string("CADASTRE_WORKFLOW_TRIGGER_TOKEN").pipe(
          Effect.catchTag("ConfigError", () => Effect.succeed("")),
        );
        if (!expected || headers.authorization !== `Bearer ${expected}`)
          return yield* new HttpApiError.Unauthorized();
        if (payload.idempotencyKey !== undefined && payload.idempotencyKey.trim() === "")
          return yield* new HttpApiError.BadRequest();
        const idempotencyKey =
          payload.idempotencyKey ?? `manual-${DateTime.formatIso(yield* DateTime.now)}`;
        const executionId = yield* CadastreSyncWorkflow.execute(
          { idempotencyKey, trigger: "manual" },
          { discard: true },
        ).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.InternalServerError())));
        return { executionId, idempotencyKey };
      }),
    )
    .handle(
      "retryFromImport",
      Effect.fn("WorkflowLive.retryFromImport")(function* ({ headers, params }) {
        const expected = yield* Config.string("CADASTRE_WORKFLOW_TRIGGER_TOKEN").pipe(
          Effect.catchTag("ConfigError", () => Effect.succeed("")),
        );
        if (!expected || headers.authorization !== `Bearer ${expected}`)
          return yield* new HttpApiError.Unauthorized();
        if (!/^[0-9a-f]{32}$/.test(params.executionId)) return yield* new HttpApiError.BadRequest();
        const repo = yield* WorkflowProjectionRepo;
        const parent = yield* repo
          .detail(params.executionId)
          .pipe(
            Effect.catchTag("EffectDrizzleQueryError", () =>
              Effect.fail(new HttpApiError.InternalServerError()),
            ),
          );
        if (
          !parent ||
          (parent.status !== "failed" && parent.status !== "cancelled") ||
          (parent.status === "failed" && parent.failedStep !== "import-postgis")
        )
          return yield* new HttpApiError.BadRequest();
        if (
          yield* repo
            .activeImport()
            .pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.InternalServerError())))
        )
          return yield* new HttpApiError.Conflict();
        const existing = yield* repo
          .recovery(params.executionId)
          .pipe(
            Effect.catchTag("EffectDrizzleQueryError", () =>
              Effect.fail(new HttpApiError.InternalServerError()),
            ),
          );
        if (existing && (existing.status === "running" || existing.status === "succeeded"))
          return {
            executionId: existing.id,
            parentExecutionId: params.executionId,
            status: existing.status,
          };
        const artifact = yield* repo
          .sourceArtifact(params.executionId)
          .pipe(
            Effect.catchTag("EffectDrizzleQueryError", () =>
              Effect.fail(new HttpApiError.InternalServerError()),
            ),
          );
        if (
          !artifact ||
          !artifact.objectKey.trim() ||
          !artifact.etag.trim() ||
          !Number.isSafeInteger(artifact.size) ||
          artifact.size <= 0 ||
          !artifact.checksum ||
          !/^[0-9a-f]{64}$/i.test(artifact.checksum)
        )
          return yield* new HttpApiError.Conflict();
        const artifactUrl = yield* Config.string("CADASTRE_ARTIFACT_URL").pipe(
          Effect.catchTag("ConfigError", () => Effect.succeed("")),
        );
        const token = yield* Config.string("CADASTRE_ARTIFACT_TOKEN").pipe(
          Effect.catchTag("ConfigError", () => Effect.succeed("")),
        );
        if (!artifactUrl.trim() || !token.trim())
          return yield* new HttpApiError.InternalServerError();
        const head = yield* Effect.tryPromise(() =>
          fetch(
            `${artifactUrl.replace(/\/$/, "")}/source?objectKey=${encodeURIComponent(artifact.objectKey)}`,
            {
              method: "HEAD",
              headers: { authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(30_000),
            },
          ),
        ).pipe(Effect.catchCause(() => Effect.succeed(null)));
        if (
          !head?.ok ||
          Number(head.headers.get("content-length")) !== artifact.size ||
          head.headers.get("etag") !== artifact.etag ||
          head.headers.get("x-content-sha256") !== artifact.checksum
        )
          return yield* new HttpApiError.Conflict();
        const retryAttempt = (existing?.retryAttempt ?? 0) + 1;
        const idempotencyKey = `retry-import/${params.executionId}/${retryAttempt}`;
        const child = yield* CadastreSyncWorkflow.execute(
          {
            idempotencyKey,
            trigger: "recovery",
            source: {
              objectKey: artifact.objectKey,
              size: artifact.size,
              etag: artifact.etag,
              checksum: artifact.checksum,
            },
            parentExecutionId: params.executionId,
            retryAttempt,
          },
          { discard: true },
        ).pipe(Effect.catchCause(() => Effect.fail(new HttpApiError.InternalServerError())));
        return { executionId: child, parentExecutionId: params.executionId, status: "running" };
      }),
    )
    .handle(
      "cancelWorkflow",
      Effect.fn("WorkflowLive.cancelWorkflow")(function* ({ headers, params }) {
        const expected = yield* Config.string("CADASTRE_WORKFLOW_TRIGGER_TOKEN").pipe(
          Effect.catchTag("ConfigError", () => Effect.succeed("")),
        );
        if (!expected || headers.authorization !== `Bearer ${expected}`)
          return yield* new HttpApiError.Unauthorized();
        if (!/^[0-9a-f]{32}$/.test(params.executionId)) return yield* new HttpApiError.BadRequest();
        yield* CadastreSyncWorkflow.interrupt(params.executionId);
        const projection = yield* WorkflowProjection;
        const finishedAt = yield* DateTime.now;
        yield* projection.cancelWorkflow(params.executionId, DateTime.toDate(finishedAt)).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );
        return { executionId: params.executionId, status: "cancelled" as const };
      }),
    )
    .handle(
      "listWorkflows",
      Effect.fn("WorkflowLive.listWorkflows")(function* ({ query }) {
        const service = yield* WorkflowProjection;
        const result = yield* service.list(boundedLimit(query.limit), query.cursor).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );
        return {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            startedAt: item.startedAt.toISOString(),
            finishedAt: item.finishedAt?.toISOString() ?? null,
          })),
        };
      }),
    )
    .handle(
      "getWorkflow",
      Effect.fn("WorkflowLive.getWorkflow")(function* ({ params }) {
        const service = yield* WorkflowProjection;
        const result = yield* service.detail(params.id).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );
        return result === null
          ? null
          : {
              ...result,
              startedAt: result.startedAt.toISOString(),
              finishedAt: result.finishedAt?.toISOString() ?? null,
              activities: result.activities.map((item) => ({
                ...item,
                startedAt: item.startedAt.toISOString(),
                finishedAt: item.finishedAt?.toISOString() ?? null,
              })),
            };
      }),
    )
    .handle(
      "listSchedules",
      Effect.fn("WorkflowLive.listSchedules")(function* ({ query }) {
        const service = yield* WorkflowProjection;
        return yield* service.schedules(boundedLimit(query.limit), query.cursor).pipe(
          Effect.catchTags({
            EffectDrizzleQueryError: () => Effect.fail(new HttpApiError.InternalServerError()),
          }),
        );
      }),
    ),
);
