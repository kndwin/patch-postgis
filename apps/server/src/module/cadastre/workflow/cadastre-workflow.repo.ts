import { Context, DateTime, Effect, Layer } from "effect";
import { desc, eq, gt, lt, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Db } from "../../../platform/database/client";
import type { WorkflowActivityAttempt, WorkflowExecution } from "./cadastre-workflow.model";
import {
  workflowExecutions,
  workflowActivityAttempts,
  workflowCronSchedules,
  workflowCronOccurrences,
} from "./cadastre-workflow.model";

interface WorkflowStep {
  readonly name: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

type WorkflowExecutionWithParsedSteps = Omit<WorkflowExecution, "steps"> & {
  readonly steps: readonly WorkflowStep[] | null;
};

export type WorkflowDetail = WorkflowExecutionWithParsedSteps & {
  readonly activities: readonly WorkflowActivityAttempt[];
};
export type WorkflowPage = {
  readonly items: readonly WorkflowExecutionWithParsedSteps[];
  readonly nextCursor: string | null;
};
export type SchedulePage = {
  readonly schedules: readonly {
    readonly id: string;
    readonly expression: string;
    readonly timezone: string;
    readonly workflowName: string;
    readonly enabled: string;
  }[];
  readonly occurrences: readonly unknown[];
  readonly nextCursor: string | null;
};

/** Persistence boundary for the application-owned workflow projection. */
interface WorkflowProjectionRepoContract {
  readonly list: (
    limit: number,
    cursor: string | undefined,
  ) => Effect.Effect<WorkflowPage, EffectDrizzleQueryError>;
  readonly detail: (id: string) => Effect.Effect<WorkflowDetail | null, EffectDrizzleQueryError>;
  readonly schedules: (
    limit: number,
    cursor: string | undefined,
  ) => Effect.Effect<SchedulePage, EffectDrizzleQueryError>;
}

function parseSteps(stepsJson: string | null): readonly WorkflowStep[] | null {
  if (!stepsJson) return null;
  return JSON.parse(stepsJson) as readonly WorkflowStep[];
}

export class WorkflowProjectionRepo extends Context.Service<
  WorkflowProjectionRepo,
  WorkflowProjectionRepoContract
>()("WorkflowProjectionRepo", {
  make: Effect.fn("WorkflowProjectionRepo.make")(function* () {
    const db = yield* Db;
    return {
      list: (limit: number, cursor: string | undefined) =>
        Effect.fn("WorkflowProjectionRepo.list")(function* () {
          // Fetch one extra to determine if there's a next page
          const fetchLimit = limit + 1;

          // Build query dynamically based on whether we have a cursor
          const results = cursor
            ? yield* db
                .select()
                .from(workflowExecutions)
                .where(
                  lt(workflowExecutions.startedAt, DateTime.toDate(DateTime.makeUnsafe(cursor))),
                )
                .orderBy(desc(workflowExecutions.startedAt))
                .limit(fetchLimit)
            : yield* db
                .select()
                .from(workflowExecutions)
                .orderBy(desc(workflowExecutions.startedAt))
                .limit(fetchLimit);

          const hasMore = results.length > limit;
          const items = results.slice(0, limit);
          const nextCursor =
            hasMore && items.length > 0 ? items[items.length - 1].startedAt.toISOString() : null;

          return {
            items: items.map((item) => ({
              ...item,
              steps: parseSteps(item.steps),
            })),
            nextCursor,
          };
        })(),
      detail: (id: string) =>
        Effect.fn("WorkflowProjectionRepo.detail")(function* () {
          const result = yield* db
            .select()
            .from(workflowExecutions)
            .where(eq(workflowExecutions.id, id))
            .limit(1);

          if (result.length === 0) return null;

          const execution = result[0];
          const activities = yield* db
            .select()
            .from(workflowActivityAttempts)
            .where(eq(workflowActivityAttempts.executionId, id));

          return {
            ...execution,
            steps: parseSteps(execution.steps),
            activities,
          };
        })(),
      schedules: (limit: number, cursor: string | undefined) =>
        Effect.fn("WorkflowProjectionRepo.schedules")(function* () {
          // Fetch one extra to determine if there's a next page
          const fetchLimit = limit + 1;

          // Build query dynamically based on whether we have a cursor
          const schedules = cursor
            ? yield* db
                .select()
                .from(workflowCronSchedules)
                .where(gt(workflowCronSchedules.id, cursor))
                .limit(fetchLimit)
            : yield* db.select().from(workflowCronSchedules).limit(fetchLimit);

          const hasMore = schedules.length > limit;
          const items = schedules.slice(0, limit);
          const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].id : null;

          // Get occurrences for the returned schedules
          const scheduleIds = items.map((s) => s.id);
          let occurrences: readonly (typeof workflowCronOccurrences.$inferSelect)[] = [];

          if (scheduleIds.length > 0) {
            occurrences = yield* db
              .select()
              .from(workflowCronOccurrences)
              .where(sql`${workflowCronOccurrences.scheduleId} IN (${sql.join(scheduleIds)})`)
              .orderBy(desc(workflowCronOccurrences.scheduledAt))
              .limit(100);
          }

          return {
            schedules: items.map((s) => ({
              id: s.id,
              expression: s.expression,
              timezone: s.timezone,
              workflowName: s.workflowName,
              enabled: s.enabled,
            })),
            occurrences: occurrences.map((o) => ({
              scheduledTime: o.scheduledAt.toISOString(),
            })),
            nextCursor,
          };
        })(),
    };
  })(),
}) {}

// The projection tables are queried from the database.
export const WorkflowProjectionRepoLive = Layer.effect(
  WorkflowProjectionRepo,
  WorkflowProjectionRepo.make,
);
