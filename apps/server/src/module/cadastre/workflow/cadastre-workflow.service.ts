import { Context, Effect, Layer } from "effect";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { DbLive } from "../../../platform/database/client";
import { WorkflowProjectionRepo, WorkflowProjectionRepoLive } from "./cadastre-workflow.repo";
import type { WorkflowDetail, WorkflowPage, SchedulePage } from "./cadastre-workflow.repo";

export class WorkflowProjection extends Context.Service<
  WorkflowProjection,
  {
    readonly list: (
      limit: number,
      cursor: string | undefined,
    ) => Effect.Effect<WorkflowPage, EffectDrizzleQueryError>;
    readonly detail: (id: string) => Effect.Effect<WorkflowDetail | null, EffectDrizzleQueryError>;
    readonly schedules: (
      limit: number,
      cursor: string | undefined,
    ) => Effect.Effect<SchedulePage, EffectDrizzleQueryError>;
    readonly cancelWorkflow: (
      id: string,
      finishedAt: Date,
    ) => Effect.Effect<void, EffectDrizzleQueryError>;
  }
>()("WorkflowProjection", {
  make: Effect.fn("WorkflowProjection.make")(function* () {
    const repo = yield* WorkflowProjectionRepo;
    return {
      list: repo.list,
      detail: repo.detail,
      schedules: repo.schedules,
      cancelWorkflow: repo.cancelWorkflow,
    };
  })(),
}) {}

export const WorkflowProjectionLive = Layer.effect(WorkflowProjection)(
  WorkflowProjection.make,
).pipe(Layer.provide(WorkflowProjectionRepoLive), Layer.provide(DbLive));
