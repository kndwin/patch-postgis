import { Context, DateTime, Effect, Layer } from "effect";
import { and, count, desc, eq, gt, lt, notInArray, sql } from "drizzle-orm";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Db } from "../../../platform/database/client";
import { PgClient } from "@effect/sql-pg";
import type { WorkflowActivityAttempt, WorkflowExecution } from "./cadastre-workflow.model";
import {
  workflowExecutions,
  workflowActivityAttempts,
  workflowCronSchedules,
  workflowCronOccurrences,
  workflowSourceArtifacts,
} from "./cadastre-workflow.model";

interface WorkflowStep {
  readonly name: string;
  readonly status: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export const WorkflowProjectionError = "Workflow projection update failed";
export const safeActivityError = () => "Activity failed";

export class WorkflowReplayRejected extends Error {
  readonly name = "WorkflowReplayRejected";
}

export const requireRunningExecution = (
  executionId: string,
  execution: { readonly status: string } | null,
): Effect.Effect<void> =>
  execution?.status === "running"
    ? Effect.void
    : Effect.die(new WorkflowReplayRejected(`Execution ${executionId} is missing or terminal`));

/** Activity failures are details on a running execution; the workflow finalizer owns terminal state. */
export const activityWorkflowStatus = (_status: "completed" | "failed") => "running" as const;

export const attemptId = (executionId: string, activityName: string, attempt: number) =>
  `activity-${Buffer.from(`${executionId}\0${activityName}\0${attempt}`).toString("base64url")}`;

export const workflowStepNames = [
  "request-dataset-api",
  "wait-cadastre-email/*",
  "extract-download-link",
  "download-gdb",
  "import-postgis",
  "validate-promote",
  "build-pmtiles",
  "upload",
  "verify-publish",
] as const;

export const initialSteps = (at: string): readonly WorkflowStep[] =>
  workflowStepNames.map((name) => ({ name, status: "pending", startedAt: at, finishedAt: null }));

export const transitionSteps = (
  steps: readonly WorkflowStep[],
  name: string,
  status: string,
  at: string,
): readonly WorkflowStep[] =>
  steps.map((step) =>
    step.name === name
      ? {
          ...step,
          status,
          startedAt: status === "running" ? at : step.startedAt,
          finishedAt: status === "completed" || status === "failed" ? at : step.finishedAt,
        }
      : step,
  );

type WorkflowExecutionWithParsedSteps = Omit<WorkflowExecution, "steps"> & {
  readonly steps: readonly WorkflowStep[] | null;
};

export type WorkflowDetail = WorkflowExecutionWithParsedSteps & {
  readonly activities: readonly WorkflowActivityAttempt[];
};
export type WorkflowPage = {
  readonly items: readonly WorkflowExecutionWithParsedSteps[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
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

export type StartWorkflowInput = {
  readonly id: string;
  readonly trigger: string;
  readonly idempotencyKey: string;
  readonly startedAt: Date;
  readonly parentExecutionId?: string;
  readonly retryAttempt?: number;
};
export type UpdateWorkflowInput = {
  readonly id: string;
  readonly status: string;
  readonly steps: readonly WorkflowStep[];
  readonly finishedAt?: Date;
  readonly error?: string | null;
  readonly failedStep?: string | null;
};
export type StartActivityInput = {
  readonly id: string;
  readonly executionId: string;
  readonly activityName: string;
  readonly attempt: number;
  readonly startedAt: Date;
};
export type FinishActivityInput = {
  readonly id: string;
  readonly status: string;
  readonly finishedAt: Date;
  readonly error?: string | null;
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
  readonly startWorkflow: (
    input: StartWorkflowInput,
  ) => Effect.Effect<{ readonly status: string }, EffectDrizzleQueryError>;
  readonly updateWorkflow: (
    input: UpdateWorkflowInput,
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly startActivity: (
    input: StartActivityInput,
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly finishActivity: (
    input: FinishActivityInput,
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly cancelWorkflow: (
    id: string,
    finishedAt: Date,
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly ensureSchedule: Effect.Effect<void, EffectDrizzleQueryError>;
  readonly recordOccurrence: (
    scheduledAt: Date,
    executionId: string,
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly saveSourceArtifact: (input: {
    executionId: string;
    objectKey: string;
    size: number;
    etag: string;
    checksum?: string;
    createdAt: Date;
  }) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly sourceArtifact: (
    executionId: string,
  ) => Effect.Effect<typeof workflowSourceArtifacts.$inferSelect | null, EffectDrizzleQueryError>;
  readonly activeImport: () => Effect.Effect<boolean, unknown>;
  readonly recovery: (
    parentExecutionId: string,
  ) => Effect.Effect<WorkflowExecution | null, EffectDrizzleQueryError>;
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
    const pg = yield* PgClient.PgClient;
    return {
      list: (limit: number, cursor: string | undefined) =>
        Effect.fn("WorkflowProjectionRepo.list")(function* () {
          const [{ totalCount }] = yield* db
            .select({ totalCount: count() })
            .from(workflowExecutions);
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
            totalCount,
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
          yield* db
            .insert(workflowCronSchedules)
            .values({
              id: "cadastre-sync-daily",
              workflowName: "CadastreSyncWorkflow",
              expression: "0 0 2 * * *",
              timezone: "Australia/Sydney",
              enabled: "true",
            })
            .onConflictDoNothing();
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
      startWorkflow: (input: StartWorkflowInput) =>
        Effect.fn("WorkflowProjectionRepo.startWorkflow")(function* () {
          const inserted = yield* db
            .insert(workflowExecutions)
            .values({
              id: input.id,
              workflowName: "CadastreSyncWorkflow",
              status: "running",
              trigger: input.trigger,
              idempotencyKey: input.idempotencyKey,
              startedAt: input.startedAt,
              steps: JSON.stringify(initialSteps(input.startedAt.toISOString())),
              parentExecutionId: input.parentExecutionId,
              retryAttempt: input.retryAttempt,
            })
            .onConflictDoNothing()
            .returning({ status: workflowExecutions.status });
          if (inserted.length > 0) return inserted[0];
          const existing = yield* db
            .select({ status: workflowExecutions.status })
            .from(workflowExecutions)
            .where(eq(workflowExecutions.id, input.id))
            .limit(1);
          if (existing.length === 0)
            return yield* Effect.die(
              new WorkflowReplayRejected(`Execution ${input.id} disappeared after conflict`),
            );
          return existing[0];
        })(),
      updateWorkflow: (input: UpdateWorkflowInput) =>
        db
          .update(workflowExecutions)
          .set({
            status: input.status,
            steps: JSON.stringify(input.steps),
            ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
            ...(input.error !== undefined ? { error: input.error } : {}),
            ...(input.failedStep !== undefined ? { failedStep: input.failedStep } : {}),
          })
          .where(
            and(
              eq(workflowExecutions.id, input.id),
              notInArray(workflowExecutions.status, ["succeeded", "failed", "cancelled"]),
            ),
          ),
      startActivity: (input: StartActivityInput) =>
        db
          .insert(workflowActivityAttempts)
          .values({
            id: input.id,
            executionId: input.executionId,
            activityName: input.activityName,
            attempt: input.attempt,
            status: "running",
            startedAt: input.startedAt,
          })
          .onConflictDoNothing(),
      finishActivity: (input: FinishActivityInput) =>
        db
          .update(workflowActivityAttempts)
          .set({
            status: input.status,
            finishedAt: input.finishedAt,
            ...(input.error !== undefined ? { error: input.error } : {}),
          })
          .where(
            and(
              eq(workflowActivityAttempts.id, input.id),
              eq(workflowActivityAttempts.status, "running"),
            ),
          ),
      cancelWorkflow: (id: string, finishedAt: Date) =>
        Effect.fn("WorkflowProjectionRepo.cancelWorkflow")(function* () {
          const execution = yield* db
            .select({ steps: workflowExecutions.steps })
            .from(workflowExecutions)
            .where(and(eq(workflowExecutions.id, id), eq(workflowExecutions.status, "running")))
            .limit(1);
          if (execution.length === 0) return;
          const steps = (parseSteps(execution[0].steps) ?? []).map((step) =>
            step.status === "running"
              ? { ...step, status: "cancelled", finishedAt: finishedAt.toISOString() }
              : step,
          );
          yield* db
            .update(workflowActivityAttempts)
            .set({ status: "cancelled", finishedAt, error: null })
            .where(
              and(
                eq(workflowActivityAttempts.executionId, id),
                eq(workflowActivityAttempts.status, "running"),
              ),
            );
          yield* db
            .update(workflowExecutions)
            .set({ status: "cancelled", finishedAt, steps: JSON.stringify(steps), error: null })
            .where(and(eq(workflowExecutions.id, id), eq(workflowExecutions.status, "running")));
        })(),
      ensureSchedule: db
        .insert(workflowCronSchedules)
        .values({
          id: "cadastre-sync-daily",
          workflowName: "CadastreSyncWorkflow",
          expression: "0 0 2 * * *",
          timezone: "Australia/Sydney",
          enabled: "true",
        })
        .onConflictDoNothing(),
      recordOccurrence: (scheduledAt: Date, executionId: string) =>
        db
          .insert(workflowCronOccurrences)
          .values({
            id: `occurrence-${executionId}`,
            scheduleId: "cadastre-sync-daily",
            scheduledAt,
            status: "triggered",
            executionId,
          })
          .onConflictDoNothing(),
      saveSourceArtifact: (input: {
        executionId: string;
        objectKey: string;
        size: number;
        etag: string;
        checksum?: string;
        createdAt: Date;
      }) =>
        db
          .insert(workflowSourceArtifacts)
          .values(input)
          .onConflictDoUpdate({ target: workflowSourceArtifacts.executionId, set: input }),
      sourceArtifact: (executionId: string) =>
        Effect.fn("WorkflowProjectionRepo.sourceArtifact")(function* () {
          const rows = yield* db
            .select()
            .from(workflowSourceArtifacts)
            .where(eq(workflowSourceArtifacts.executionId, executionId))
            .limit(1);
          return rows[0] ?? null;
        })(),
      activeImport: () =>
        Effect.fn("WorkflowProjectionRepo.activeImport")(function* () {
          // A projection row can lag the actual import. Probe the same
          // session-scoped lock used by the importer instead.
          return yield* Effect.scoped(
            Effect.fn("WorkflowProjectionRepo.probeImportLock")(function* () {
              const reserved = yield* pg.reserve;
              let locked = false;
              return yield* Effect.fn("WorkflowProjectionRepo.tryImportLock")(function* () {
                const result = yield* reserved.executeRaw(
                  "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
                  ["cadastre_lots_import"],
                );
                locked = Boolean((result as { rows: { locked: boolean }[] }).rows[0]?.locked);
                return !locked;
              })().pipe(
                Effect.ensuring(
                  Effect.uninterruptible(
                    Effect.fn("WorkflowProjectionRepo.unlockImportLock")(function* () {
                      if (locked)
                        yield* reserved.executeRaw("SELECT pg_advisory_unlock(hashtext($1))", [
                          "cadastre_lots_import",
                        ]);
                    })().pipe(Effect.catchCause(() => Effect.void)),
                  ),
                ),
              );
            })(),
          );
        })(),
      recovery: (parentExecutionId: string) =>
        Effect.fn("WorkflowProjectionRepo.recovery")(function* () {
          const rows = yield* db
            .select()
            .from(workflowExecutions)
            .where(eq(workflowExecutions.parentExecutionId, parentExecutionId))
            .orderBy(desc(workflowExecutions.retryAttempt))
            .limit(1);
          return rows[0] ?? null;
        })(),
    };
  })(),
}) {}

// The projection tables are queried from the database.
export const WorkflowProjectionRepoLive = Layer.effect(
  WorkflowProjectionRepo,
  WorkflowProjectionRepo.make,
);
