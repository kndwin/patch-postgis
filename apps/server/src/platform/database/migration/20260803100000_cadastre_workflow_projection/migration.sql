CREATE TABLE IF NOT EXISTS workflow_executions (
  id text PRIMARY KEY, workflow_name text NOT NULL, status text NOT NULL,
  trigger text NOT NULL, idempotency_key text NOT NULL UNIQUE,
  started_at timestamptz NOT NULL, finished_at timestamptz, error text
);
CREATE INDEX IF NOT EXISTS workflow_executions_started_at_idx ON workflow_executions (started_at);
CREATE TABLE IF NOT EXISTS workflow_activity_attempts (
  id text PRIMARY KEY, execution_id text NOT NULL, activity_name text NOT NULL,
  attempt integer NOT NULL, status text NOT NULL, started_at timestamptz NOT NULL,
  finished_at timestamptz, error text
);
CREATE INDEX IF NOT EXISTS workflow_activity_attempts_execution_idx ON workflow_activity_attempts (execution_id);
CREATE TABLE IF NOT EXISTS workflow_cron_schedules (
  id text PRIMARY KEY, workflow_name text NOT NULL, expression text NOT NULL,
  timezone text NOT NULL, enabled text NOT NULL
);
CREATE TABLE IF NOT EXISTS workflow_cron_occurrences (
  id text PRIMARY KEY, schedule_id text NOT NULL, scheduled_at timestamptz NOT NULL,
  status text NOT NULL, execution_id text
);
CREATE INDEX IF NOT EXISTS workflow_cron_occurrences_schedule_idx ON workflow_cron_occurrences (schedule_id, scheduled_at);
