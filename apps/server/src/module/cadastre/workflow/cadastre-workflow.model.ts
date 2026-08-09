import { bigint, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Application-owned projection. Effect's cluster tables are deliberately not queried by the dashboard. */
export const workflowExecutions = pgTable(
  "workflow_executions",
  {
    id: text("id").primaryKey(),
    workflowName: text("workflow_name").notNull(),
    status: text("status").notNull(),
    trigger: text("trigger").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
    failedStep: text("failed_step"),
    steps: text("steps"), // JSON array stored as text
    parentExecutionId: text("parent_execution_id"),
    retryAttempt: integer("retry_attempt"),
  },
  (table) => [index("workflow_executions_started_at_idx").on(table.startedAt)],
);

export const workflowSourceArtifacts = pgTable("workflow_source_artifacts", {
  executionId: text("execution_id").primaryKey(),
  objectKey: text("object_key").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  etag: text("etag").notNull(),
  checksum: text("checksum"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const workflowActivityAttempts = pgTable(
  "workflow_activity_attempts",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull(),
    activityName: text("activity_name").notNull(),
    attempt: integer("attempt").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: text("error"),
  },
  (table) => [index("workflow_activity_attempts_execution_idx").on(table.executionId)],
);

export const workflowCronSchedules = pgTable("workflow_cron_schedules", {
  id: text("id").primaryKey(),
  workflowName: text("workflow_name").notNull(),
  expression: text("expression").notNull(),
  timezone: text("timezone").notNull(),
  enabled: text("enabled").notNull(),
});

export const workflowCronOccurrences = pgTable(
  "workflow_cron_occurrences",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    status: text("status").notNull(),
    executionId: text("execution_id"),
  },
  (table) => [
    index("workflow_cron_occurrences_schedule_idx").on(table.scheduleId, table.scheduledAt),
  ],
);

export type WorkflowExecution = typeof workflowExecutions.$inferSelect;
export type WorkflowActivityAttempt = typeof workflowActivityAttempts.$inferSelect;
