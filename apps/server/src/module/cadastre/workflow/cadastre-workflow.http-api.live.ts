import { Config, DateTime, Effect } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { AppApi } from "@patch/http-contract";
import { WorkflowProjection } from "./cadastre-workflow.service";
import { CadastreSyncWorkflow } from "./cadastre-workflow.workflow";

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
