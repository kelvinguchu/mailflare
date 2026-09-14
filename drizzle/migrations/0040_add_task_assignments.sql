ALTER TABLE calendar_tasks ADD COLUMN assignee_user_id text REFERENCES users(id) ON DELETE set null;
ALTER TABLE calendar_tasks ADD COLUMN completed_by_user_id text REFERENCES users(id) ON DELETE set null;
ALTER TABLE calendar_tasks ADD COLUMN assigned_at integer;

UPDATE calendar_tasks
SET assignee_user_id = user_id,
    assigned_at = created_at
WHERE assignee_user_id IS NULL;

CREATE INDEX calendar_tasks_assignee_status_due_idx
  ON calendar_tasks(assignee_user_id, status, due_at);
