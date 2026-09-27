ALTER TABLE messages ADD COLUMN trashed_at integer;

-- Existing trash receives a fresh retention window on rollout.
UPDATE messages
SET trashed_at = unixepoch()
WHERE status = 'trash' AND trashed_at IS NULL;

CREATE TRIGGER messages_set_trashed_at_after_insert
AFTER INSERT ON messages
WHEN new.status = 'trash' AND new.trashed_at IS NULL
BEGIN
	UPDATE messages SET trashed_at = unixepoch() WHERE id = new.id;
END;

CREATE TRIGGER messages_set_trashed_at_after_status_update
AFTER UPDATE OF status ON messages
BEGIN
	UPDATE messages
	SET trashed_at = CASE
		WHEN new.status = 'trash' AND old.status <> 'trash' THEN unixepoch()
		WHEN new.status <> 'trash' THEN NULL
		ELSE trashed_at
	END
	WHERE id = new.id;
END;

CREATE INDEX messages_trash_retention_idx
	ON messages (status, trashed_at);

CREATE TABLE storage_deletion_jobs (
	id text PRIMARY KEY NOT NULL,
	message_id text NOT NULL UNIQUE,
	actor_user_id text REFERENCES users(id) ON DELETE set null,
	mailbox_id text REFERENCES mailboxes(id) ON DELETE set null,
	reason text NOT NULL CHECK (reason IN ('user', 'draft', 'retention')),
	status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'failed', 'completed')),
	object_keys text DEFAULT '[]' NOT NULL,
	attempt_count integer DEFAULT 0 NOT NULL,
	next_attempt_at integer,
	last_error text,
	created_at integer NOT NULL,
	updated_at integer NOT NULL,
	completed_at integer
);

CREATE INDEX storage_deletion_jobs_due_idx
	ON storage_deletion_jobs (status, next_attempt_at, created_at);

CREATE INDEX storage_deletion_jobs_completed_idx
	ON storage_deletion_jobs (completed_at);

CREATE TABLE storage_lifecycle_state (
	prefix text PRIMARY KEY NOT NULL,
	cursor text,
	last_scanned_at integer,
	updated_at integer NOT NULL
);
