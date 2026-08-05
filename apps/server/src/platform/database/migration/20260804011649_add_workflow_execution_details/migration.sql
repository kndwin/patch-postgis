ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS failed_step text;
ALTER TABLE workflow_executions ADD COLUMN IF NOT EXISTS steps text;
