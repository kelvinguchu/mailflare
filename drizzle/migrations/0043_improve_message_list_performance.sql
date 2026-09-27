CREATE INDEX IF NOT EXISTS messages_mailbox_status_created_id_idx
	ON messages (mailbox_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_mailbox_folder_created_id_idx
	ON messages (mailbox_id, folder_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_mailbox_read_created_id_idx
	ON messages (mailbox_id, read, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_mailbox_starred_created_id_idx
	ON messages (mailbox_id, starred, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_mailbox_snoozed_created_id_idx
	ON messages (mailbox_id, snoozed_until, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS messages_mailbox_thread_key_created_id_idx
	ON messages (mailbox_id, coalesce(thread_id, id), created_at DESC, id DESC);

PRAGMA optimize;
