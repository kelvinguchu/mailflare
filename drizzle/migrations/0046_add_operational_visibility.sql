CREATE TABLE operational_settings (
	id text PRIMARY KEY NOT NULL,
	queue_backlog_warning integer DEFAULT 100 NOT NULL CHECK (queue_backlog_warning >= 1),
	queue_oldest_minutes_warning integer DEFAULT 15 NOT NULL CHECK (queue_oldest_minutes_warning >= 1),
	delivery_failed_24h_warning integer DEFAULT 1 NOT NULL CHECK (delivery_failed_24h_warning >= 1),
	delivery_unknown_24h_warning integer DEFAULT 1 NOT NULL CHECK (delivery_unknown_24h_warning >= 1),
	webhook_failed_24h_warning integer DEFAULT 1 NOT NULL CHECK (webhook_failed_24h_warning >= 1),
	reminder_failed_24h_warning integer DEFAULT 1 NOT NULL CHECK (reminder_failed_24h_warning >= 1),
	dead_letter_unresolved_warning integer DEFAULT 1 NOT NULL CHECK (dead_letter_unresolved_warning >= 1),
	backup_stale_hours integer DEFAULT 0 NOT NULL CHECK (backup_stale_hours >= 0),
	d1_growth_percent_warning integer DEFAULT 25 NOT NULL CHECK (d1_growth_percent_warning >= 1),
	r2_growth_percent_warning integer DEFAULT 25 NOT NULL CHECK (r2_growth_percent_warning >= 1),
	updated_at integer NOT NULL
);

INSERT INTO operational_settings (id, updated_at) VALUES ('default', unixepoch());

CREATE TABLE operational_snapshots (
	id text PRIMARY KEY NOT NULL,
	captured_at integer NOT NULL,
	d1_bytes integer NOT NULL CHECK (d1_bytes >= 0),
	r2_object_count integer NOT NULL CHECK (r2_object_count >= 0),
	r2_bytes integer NOT NULL CHECK (r2_bytes >= 0),
	r2_scan_complete integer DEFAULT true NOT NULL,
	inbound_backlog_count integer,
	inbound_backlog_bytes integer,
	inbound_oldest_at integer,
	outbound_backlog_count integer,
	outbound_backlog_bytes integer,
	outbound_oldest_at integer,
	webhook_backlog_count integer,
	webhook_backlog_bytes integer,
	webhook_oldest_at integer
);

CREATE INDEX operational_snapshots_captured_idx
	ON operational_snapshots(captured_at DESC);

CREATE TABLE restore_drill_records (
	id text PRIMARY KEY NOT NULL,
	backup_id text REFERENCES backups(id) ON DELETE set null,
	environment text NOT NULL CHECK (environment IN ('staging', 'production')),
	source text NOT NULL CHECK (source IN ('staging-script', 'manual')),
	verified_by_user_id text REFERENCES users(id) ON DELETE set null,
	verified_at integer NOT NULL,
	d1_verified integer DEFAULT false NOT NULL,
	r2_verified integer DEFAULT false NOT NULL,
	rollback_verified integer DEFAULT false NOT NULL,
	sessions_invalidated integer DEFAULT false NOT NULL,
	cleanup_verified integer DEFAULT false NOT NULL
);

CREATE INDEX restore_drill_records_verified_idx
	ON restore_drill_records(verified_at DESC);
