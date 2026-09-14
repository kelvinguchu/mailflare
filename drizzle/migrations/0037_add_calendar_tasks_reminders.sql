ALTER TABLE calendar_events ADD COLUMN organizer text;
ALTER TABLE calendar_events ADD COLUMN timezone text DEFAULT 'UTC' NOT NULL;
ALTER TABLE calendar_events ADD COLUMN all_day integer DEFAULT 0 NOT NULL;
ALTER TABLE calendar_events ADD COLUMN sequence integer DEFAULT 0 NOT NULL;
ALTER TABLE calendar_events ADD COLUMN idempotency_key text;
ALTER TABLE calendar_events ADD COLUMN request_hash text;
CREATE UNIQUE INDEX calendar_events_user_idempotency_idx
  ON calendar_events(user_id, idempotency_key);

CREATE TABLE calendar_tasks (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  mailbox_id text REFERENCES mailboxes(id) ON DELETE set null,
  title text NOT NULL,
  description text DEFAULT '' NOT NULL,
  due_at integer,
  timezone text DEFAULT 'UTC' NOT NULL,
  all_day integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'open' NOT NULL CHECK (status IN ('open', 'completed')),
  priority text DEFAULT 'none' NOT NULL CHECK (priority IN ('none', 'low', 'medium', 'high')),
  completed_at integer,
  created_at integer NOT NULL,
  updated_at integer NOT NULL
);
CREATE INDEX calendar_tasks_user_status_due_idx
  ON calendar_tasks(user_id, status, due_at);
CREATE INDEX calendar_tasks_user_due_idx
  ON calendar_tasks(user_id, due_at);

CREATE TABLE calendar_reminders (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  event_id text REFERENCES calendar_events(id) ON DELETE cascade,
  task_id text REFERENCES calendar_tasks(id) ON DELETE cascade,
  mailbox_id text REFERENCES mailboxes(id) ON DELETE set null,
  title text NOT NULL,
  message text DEFAULT '' NOT NULL,
  channel text DEFAULT 'in_app' NOT NULL CHECK (channel IN ('in_app', 'email')),
  recipient text,
  from_addr text,
  remind_at integer NOT NULL,
  timezone text DEFAULT 'UTC' NOT NULL,
  status text DEFAULT 'scheduled' NOT NULL
    CHECK (status IN ('scheduled', 'processing', 'delivered', 'dismissed', 'cancelled', 'failed')),
  snoozed_until integer,
  claimed_at integer,
  delivered_at integer,
  dismissed_at integer,
  attempt_count integer DEFAULT 0 NOT NULL,
  last_error text,
  created_at integer NOT NULL,
  updated_at integer NOT NULL,
  CHECK ((event_id IS NOT NULL AND task_id IS NULL) OR (event_id IS NULL AND task_id IS NOT NULL)),
  CHECK (channel = 'in_app' OR (mailbox_id IS NOT NULL AND recipient IS NOT NULL AND from_addr IS NOT NULL))
);
CREATE INDEX calendar_reminders_due_idx
  ON calendar_reminders(status, remind_at);
CREATE INDEX calendar_reminders_user_status_idx
  ON calendar_reminders(user_id, status, remind_at);
CREATE INDEX calendar_reminders_event_idx
  ON calendar_reminders(event_id);
CREATE INDEX calendar_reminders_task_idx
  ON calendar_reminders(task_id);

CREATE TABLE calendar_reminder_deliveries (
  id text PRIMARY KEY NOT NULL,
  reminder_id text NOT NULL REFERENCES calendar_reminders(id) ON DELETE cascade,
  user_id text NOT NULL REFERENCES users(id) ON DELETE cascade,
  scheduled_for integer NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email')),
  status text NOT NULL CHECK (status IN ('delivered', 'queued', 'failed')),
  idempotency_key text NOT NULL,
  outbound_job_id text REFERENCES outbound_jobs(id) ON DELETE set null,
  message_id text REFERENCES messages(id) ON DELETE set null,
  attempt_count integer DEFAULT 1 NOT NULL,
  error text,
  created_at integer NOT NULL,
  delivered_at integer
);
CREATE UNIQUE INDEX calendar_reminder_deliveries_schedule_idx
  ON calendar_reminder_deliveries(reminder_id, scheduled_for);
CREATE INDEX calendar_reminder_deliveries_user_created_idx
  ON calendar_reminder_deliveries(user_id, created_at);
