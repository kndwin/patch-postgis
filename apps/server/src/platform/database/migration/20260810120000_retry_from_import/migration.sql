ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS parent_execution_id text;
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS retry_attempt integer;
CREATE TABLE IF NOT EXISTS workflow_source_artifacts (
  execution_id text PRIMARY KEY,
  object_key text NOT NULL,
  size bigint NOT NULL,
  etag text NOT NULL,
  checksum text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_executions_parent_retry_idx
  ON workflow_executions (parent_execution_id, retry_attempt)
  WHERE parent_execution_id IS NOT NULL;
