import { Schema } from "effect";

export const WorkflowStepSchema = Schema.Struct({
  name: Schema.String,
  status: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
});
export const ActivitySchema = Schema.Struct({
  id: Schema.String,
  activityName: Schema.String,
  attempt: Schema.Number,
  status: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
});
export const ExecutionSchema = Schema.Struct({
  id: Schema.String,
  workflowName: Schema.String,
  status: Schema.String,
  trigger: Schema.String,
  idempotencyKey: Schema.String,
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  failedStep: Schema.NullOr(Schema.String),
  steps: Schema.NullOr(Schema.Array(WorkflowStepSchema)),
  parentExecutionId: Schema.NullOr(Schema.String),
  retryAttempt: Schema.NullOr(Schema.Number),
});
export const ScheduleSchema = Schema.Struct({
  id: Schema.String,
  workflowName: Schema.String,
  expression: Schema.String,
  timezone: Schema.String,
  enabled: Schema.String,
});

export type WorkflowExecution = Schema.Schema.Type<typeof ExecutionSchema>;
export type WorkflowActivity = Schema.Schema.Type<typeof ActivitySchema>;
export type WorkflowDetail = WorkflowExecution & {
  readonly activities: readonly WorkflowActivity[];
};
export type WorkflowPage = {
  readonly items: readonly WorkflowExecution[];
  readonly nextCursor: string | null;
  readonly totalCount: number;
};
export type Schedule = Schema.Schema.Type<typeof ScheduleSchema>;
export type SchedulePage = {
  readonly schedules: readonly Schedule[];
  readonly occurrences: readonly unknown[];
  readonly nextCursor: string | null;
};
