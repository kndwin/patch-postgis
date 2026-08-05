import { Effect } from "effect";
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi";
import { AppApi } from "@patch/http-contract";
import { WorkflowProjection } from "./cadastre-workflow.service";

const boundedLimit = (value: string | undefined) =>
  Math.min(100, Math.max(1, Number(value ?? 25) || 25));
export const WorkflowLive = HttpApiBuilder.group(AppApi, "workflow", (handlers) =>
  handlers
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
