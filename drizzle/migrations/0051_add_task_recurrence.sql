ALTER TABLE calendar_tasks ADD COLUMN recurrence_rule text;
ALTER TABLE calendar_tasks ADD COLUMN recurrence_series_id text;
ALTER TABLE calendar_tasks ADD COLUMN recurrence_index integer;
CREATE UNIQUE INDEX calendar_tasks_recurrence_occurrence_idx ON calendar_tasks(recurrence_series_id, recurrence_index);
