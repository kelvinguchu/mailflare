const MIGRATION_NAMES = [
	"0000_flowery_smasher.sql",
	"0001_add_reset_email.sql",
	"0002_add_message_read.sql",
	"0003_add_contacts.sql",
	"0004_add_accounts.sql",
	"0005_add_folders.sql",
	"0006_add_rule_conditions.sql",
	"0007_add_shared_mailboxes.sql",
	"0008_add_message_attachments.sql",
	"0009_add_backups.sql",
	"0010_hard_squirrel_girl.sql",
	"0011_add_folder_colors.sql",
	"0012_add_app_settings.sql",
	"0013_add_license_settings.sql",
	"0014_add_account_permissions.sql",
	"0015_add_forwarding_email.sql",
	"0016_add_message_snooze.sql",
	"0017_add_message_star.sql",
	"0018_add_mailbox_domain_aliases.sql",
	"0019_merge_message_bodies.sql",
	"0020_add_calendar_templates_schedule.sql",
	"0021_add_mailbox_signature.sql",
	"0022_add_mailbox_auto_reply.sql",
	"0023_rebrand_default_app_name.sql",
	"0024_rename_app_to_cc_mail.sql",
	"0025_remove_license_settings.sql",
	"0026_add_company_name.sql",
	"0027_add_inbound_delivery_key.sql",
	"0028_add_outbound_idempotency.sql",
	"0029_add_dead_letter_events.sql",
	"0030_add_webhook_delivery_retries.sql",
	"0031_add_secure_account_recovery.sql",
	"0032_add_account_activation.sql",
	"0033_add_session_management_indexes.sql",
	"0034_add_administrator_mfa.sql",
	"0035_add_delivery_and_abuse_controls.sql",
	"0036_add_message_search.sql",
	"0037_add_calendar_tasks_reminders.sql",
	"0038_add_undo_send.sql",
	"0039_add_conversation_threads.sql",
	"0040_add_task_assignments.sql",
	"0041_add_rich_mailbox_signatures.sql",
	"0042_complete_indexed_message_search.sql",
	"0043_improve_message_list_performance.sql",
	"0044_add_storage_lifecycle.sql",
	"0045_add_account_archival.sql",
	"0046_add_operational_visibility.sql",
	"0047_add_cc_recipient_semantics.sql",
	"0048_add_mfa_policy.sql",
];

const SEARCH_SCHEMA_STATEMENTS = [
	`CREATE VIRTUAL TABLE message_search USING fts5(
		message_id UNINDEXED,
		sender,
		recipients,
		subject,
		snippet,
		body,
		attachment_names,
		tokenize = 'trigram'
	)`,
	`CREATE TRIGGER message_search_after_insert
	AFTER INSERT ON messages
	BEGIN
		INSERT INTO message_search (
			rowid,
			message_id,
			sender,
			recipients,
			subject,
			snippet,
			body,
			attachment_names
		)
		VALUES (
			new.rowid,
			new.id,
			new.from_addr,
			new.to_addr || ' ' || new.cc_addr,
			coalesce(new.subject, ''),
			coalesce(new.snippet, ''),
			coalesce(new.text_body, '') || ' ' || coalesce(new.html_body, ''),
			''
		);
	END`,
	`CREATE TRIGGER message_search_after_delete
	AFTER DELETE ON messages
	BEGIN
		DELETE FROM message_search WHERE rowid = old.rowid;
	END`,
	`CREATE TRIGGER message_search_after_update
	AFTER UPDATE OF id, from_addr, to_addr, cc_addr, subject, snippet, text_body, html_body ON messages
	BEGIN
		DELETE FROM message_search WHERE rowid = old.rowid;
		INSERT INTO message_search (
			rowid,
			message_id,
			sender,
			recipients,
			subject,
			snippet,
			body,
			attachment_names
		)
		SELECT
			new.rowid,
			new.id,
			new.from_addr,
			new.to_addr || ' ' || new.cc_addr,
			coalesce(new.subject, ''),
			coalesce(new.snippet, ''),
			coalesce(new.text_body, '') || ' ' || coalesce(new.html_body, ''),
			coalesce((
				SELECT group_concat(message_attachments.filename, ' ')
				FROM message_attachments
				WHERE message_attachments.message_id = new.id
			), '');
	END`,
	`CREATE TRIGGER message_search_attachment_after_insert
	AFTER INSERT ON message_attachments
	BEGIN
		UPDATE message_search
		SET attachment_names = coalesce((
			SELECT group_concat(message_attachments.filename, ' ')
			FROM message_attachments
			WHERE message_attachments.message_id = new.message_id
		), '')
		WHERE rowid = (SELECT rowid FROM messages WHERE id = new.message_id);
	END`,
	`CREATE TRIGGER message_search_attachment_after_delete
	AFTER DELETE ON message_attachments
	BEGIN
		UPDATE message_search
		SET attachment_names = coalesce((
			SELECT group_concat(message_attachments.filename, ' ')
			FROM message_attachments
			WHERE message_attachments.message_id = old.message_id
		), '')
		WHERE rowid = (SELECT rowid FROM messages WHERE id = old.message_id);
	END`,
	`CREATE TRIGGER message_search_attachment_after_update
	AFTER UPDATE OF message_id, filename ON message_attachments
	BEGIN
		UPDATE message_search
		SET attachment_names = coalesce((
			SELECT group_concat(message_attachments.filename, ' ')
			FROM message_attachments
			WHERE message_attachments.message_id = old.message_id
		), '')
		WHERE rowid = (SELECT rowid FROM messages WHERE id = old.message_id);

		UPDATE message_search
		SET attachment_names = coalesce((
			SELECT group_concat(message_attachments.filename, ' ')
			FROM message_attachments
			WHERE message_attachments.message_id = new.message_id
		), '')
		WHERE rowid = (SELECT rowid FROM messages WHERE id = new.message_id);
	END`,
] as const;

const STORAGE_LIFECYCLE_SCHEMA_STATEMENTS = [
	`CREATE TRIGGER messages_set_trashed_at_after_insert
	AFTER INSERT ON messages
	WHEN new.status = 'trash' AND new.trashed_at IS NULL
	BEGIN
		UPDATE messages SET trashed_at = unixepoch() WHERE id = new.id;
	END`,
	`CREATE TRIGGER messages_set_trashed_at_after_status_update
	AFTER UPDATE OF status ON messages
	BEGIN
		UPDATE messages
		SET trashed_at = CASE
			WHEN new.status = 'trash' AND old.status <> 'trash' THEN unixepoch()
			WHEN new.status <> 'trash' THEN NULL
			ELSE trashed_at
		END
		WHERE id = new.id;
	END`,
] as const;

const ACCOUNT_LIFECYCLE_SCHEMA_STATEMENTS = [
	`CREATE TRIGGER users_keep_active_administrator
	BEFORE UPDATE OF role, disabled, archived_at, activation_status ON users
	WHEN old.role = 'admin'
		AND old.disabled = 0
		AND old.archived_at IS NULL
		AND old.activation_status = 'active'
		AND NOT (
			new.role = 'admin'
			AND new.disabled = 0
			AND new.archived_at IS NULL
			AND new.activation_status = 'active'
		)
		AND NOT EXISTS (
			SELECT 1 FROM users
			WHERE id <> old.id
				AND role = 'admin'
				AND disabled = 0
				AND archived_at IS NULL
				AND activation_status = 'active'
		)
	BEGIN
		SELECT RAISE(ABORT, 'cannot remove the last active administrator');
	END`,
] as const;

const INITIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY NOT NULL, email text NOT NULL UNIQUE, reset_email text, reset_email_verified_at integer, forwarding_email text, password_hash text NOT NULL, name text NOT NULL, avatar_key text, role text DEFAULT 'user' NOT NULL, activation_status text DEFAULT 'active' NOT NULL, activated_at integer, invitation_sent_at integer, invitation_expires_at integer, mfa_secret_encrypted text, mfa_enabled_at integer, mfa_recovery_code_hashes text DEFAULT '[]' NOT NULL, mfa_last_used_counter integer, mfa_policy_covered_at integer, mfa_policy_exempt_until integer, mfa_policy_exemption_reason text, mfa_policy_exempted_by_user_id text REFERENCES users(id) ON DELETE set null, disabled integer DEFAULT false NOT NULL, archived_at integer, send_rate_limit_per_minute integer DEFAULT 20 NOT NULL, daily_send_limit integer DEFAULT 500 NOT NULL, can_manage_mailboxes integer DEFAULT false NOT NULL, created_by_user_id text REFERENCES users(id) ON DELETE set null, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS users_archived_role_idx ON users(archived_at, role, disabled);
CREATE INDEX IF NOT EXISTS users_created_by_idx ON users(created_by_user_id);
CREATE INDEX IF NOT EXISTS users_mfa_policy_coverage_idx ON users(activation_status, disabled, role, mfa_policy_covered_at);
CREATE TABLE IF NOT EXISTS mfa_policy_settings (id text PRIMARY KEY NOT NULL, mode text DEFAULT 'optional' NOT NULL, grace_period_days integer DEFAULT 7 NOT NULL, updated_by_user_id text REFERENCES users(id) ON DELETE set null, updated_at integer NOT NULL);
INSERT OR IGNORE INTO mfa_policy_settings (id, mode, grace_period_days, updated_at) VALUES ('default', 'optional', 7, unixepoch());
CREATE TABLE IF NOT EXISTS domains (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, hostname text NOT NULL, zone_id text NOT NULL, status text DEFAULT 'pending' NOT NULL, routing_status text, sending_subdomain_tag text, sending_enabled integer DEFAULT false NOT NULL, routing_enabled integer DEFAULT false NOT NULL, send_rate_limit_per_minute integer DEFAULT 60 NOT NULL, daily_send_limit integer DEFAULT 2000 NOT NULL, created_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS domains_hostname_idx ON domains(hostname);
CREATE INDEX IF NOT EXISTS domains_user_idx ON domains(user_id);
CREATE TABLE IF NOT EXISTS mailboxes (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, domain_id text NOT NULL REFERENCES domains(id) ON DELETE cascade, local_part text NOT NULL, display_name text, signature text, signature_text text, signature_html text, signature_version integer DEFAULT 1 NOT NULL, auto_reply_enabled integer DEFAULT false NOT NULL, auto_reply_subject text DEFAULT 'Out of office' NOT NULL, auto_reply_body text DEFAULT '' NOT NULL, avatar_key text, type text DEFAULT 'personal' NOT NULL, use_all_domains integer DEFAULT true NOT NULL, disabled integer DEFAULT false NOT NULL, created_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mailboxes_address_idx ON mailboxes(domain_id, local_part);
CREATE TABLE IF NOT EXISTS signature_assets (id text PRIMARY KEY NOT NULL, mailbox_id text NOT NULL REFERENCES mailboxes(id) ON DELETE cascade, uploaded_by_user_id text REFERENCES users(id) ON DELETE set null, filename text NOT NULL, content_type text NOT NULL, size integer NOT NULL, width integer NOT NULL, height integer NOT NULL, alt_text text DEFAULT '' NOT NULL, content_id text NOT NULL UNIQUE, r2_key text NOT NULL UNIQUE, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS signature_assets_mailbox_idx ON signature_assets(mailbox_id);
CREATE TABLE IF NOT EXISTS auto_reply_deliveries (id text PRIMARY KEY NOT NULL, mailbox_id text NOT NULL REFERENCES mailboxes(id) ON DELETE cascade, recipient text NOT NULL, sent_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS auto_reply_deliveries_mailbox_recipient_idx ON auto_reply_deliveries(mailbox_id, recipient);
CREATE INDEX IF NOT EXISTS auto_reply_deliveries_sent_idx ON auto_reply_deliveries(sent_at);
CREATE TABLE IF NOT EXISTS mailbox_access (id text PRIMARY KEY NOT NULL, mailbox_id text NOT NULL REFERENCES mailboxes(id) ON DELETE cascade, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, permission text DEFAULT 'read_only' NOT NULL, created_by_user_id text REFERENCES users(id) ON DELETE set null, created_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mailbox_access_mailbox_user_idx ON mailbox_access(mailbox_id, user_id);
CREATE INDEX IF NOT EXISTS mailbox_access_user_idx ON mailbox_access(user_id);
CREATE INDEX IF NOT EXISTS mailbox_access_mailbox_idx ON mailbox_access(mailbox_id);
CREATE TABLE IF NOT EXISTS contacts (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, email text NOT NULL, display_name text, source text DEFAULT 'inbound' NOT NULL, blocked integer DEFAULT false NOT NULL, last_seen_at integer, created_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_email_idx ON contacts(user_id, email);
CREATE INDEX IF NOT EXISTS contacts_user_idx ON contacts(user_id);
CREATE TABLE IF NOT EXISTS folders (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, mailbox_id text NOT NULL REFERENCES mailboxes(id) ON DELETE cascade, name text NOT NULL, color text DEFAULT '#2563eb' NOT NULL, created_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS folders_mailbox_name_idx ON folders(mailbox_id, name);
CREATE INDEX IF NOT EXISTS folders_user_idx ON folders(user_id);
CREATE INDEX IF NOT EXISTS folders_mailbox_idx ON folders(mailbox_id);
CREATE TABLE IF NOT EXISTS api_keys (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, name text NOT NULL, prefix text NOT NULL, key_hash text NOT NULL, scopes text NOT NULL, created_at integer NOT NULL, last_used_at integer);
CREATE TABLE IF NOT EXISTS messages (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, mailbox_id text REFERENCES mailboxes(id) ON DELETE set null, direction text NOT NULL, provider_message_id text, in_reply_to text, "references" text, reply_to_message_id text REFERENCES messages(id) ON DELETE set null, folder_id text REFERENCES folders(id) ON DELETE set null, from_addr text NOT NULL, to_addr text NOT NULL, cc_addr text DEFAULT '' NOT NULL, delivered_to_addr text, subject text, snippet text, text_body text, html_body text, raw_r2_key text, inbound_delivery_key text, status text DEFAULT 'received' NOT NULL, delivery_status text, delivery_detail text, delivery_updated_at integer, security_status text DEFAULT 'clean' NOT NULL, security_reason text, spam_score integer DEFAULT 0 NOT NULL, read integer DEFAULT false NOT NULL, starred integer DEFAULT false NOT NULL, snoozed_until integer, trashed_at integer, thread_id text, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS messages_user_created_idx ON messages(user_id, created_at);
CREATE INDEX IF NOT EXISTS messages_mailbox_idx ON messages(mailbox_id);
CREATE INDEX IF NOT EXISTS messages_mailbox_thread_created_idx ON messages(mailbox_id, thread_id, created_at);
CREATE INDEX IF NOT EXISTS messages_mailbox_status_created_id_idx ON messages(mailbox_id, status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_folder_created_id_idx ON messages(mailbox_id, folder_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_read_created_id_idx ON messages(mailbox_id, read, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_starred_created_id_idx ON messages(mailbox_id, starred, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_snoozed_created_id_idx ON messages(mailbox_id, snoozed_until, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_thread_key_created_id_idx ON messages(mailbox_id, coalesce(thread_id, id), created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_mailbox_provider_message_idx ON messages(mailbox_id, provider_message_id);
CREATE INDEX IF NOT EXISTS messages_folder_idx ON messages(folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS messages_inbound_delivery_key_idx ON messages(inbound_delivery_key);
CREATE INDEX IF NOT EXISTS messages_trash_retention_idx ON messages(status, trashed_at);
CREATE TABLE IF NOT EXISTS message_attachments (id text PRIMARY KEY NOT NULL, message_id text NOT NULL REFERENCES messages(id) ON DELETE cascade, filename text NOT NULL, content_type text NOT NULL, size integer NOT NULL, disposition text DEFAULT 'attachment' NOT NULL, content_id text, security_status text DEFAULT 'safe' NOT NULL, security_reason text, r2_key text NOT NULL UNIQUE, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS message_attachments_message_idx ON message_attachments(message_id);
CREATE TABLE IF NOT EXISTS storage_deletion_jobs (id text PRIMARY KEY NOT NULL, message_id text NOT NULL UNIQUE, actor_user_id text REFERENCES users(id) ON DELETE set null, mailbox_id text REFERENCES mailboxes(id) ON DELETE set null, reason text NOT NULL CHECK (reason IN ('user', 'draft', 'retention')), status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'processing', 'failed', 'completed')), object_keys text DEFAULT '[]' NOT NULL, attempt_count integer DEFAULT 0 NOT NULL, next_attempt_at integer, last_error text, created_at integer NOT NULL, updated_at integer NOT NULL, completed_at integer);
CREATE INDEX IF NOT EXISTS storage_deletion_jobs_due_idx ON storage_deletion_jobs(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS storage_deletion_jobs_completed_idx ON storage_deletion_jobs(completed_at);
CREATE TABLE IF NOT EXISTS storage_lifecycle_state (prefix text PRIMARY KEY NOT NULL, cursor text, last_scanned_at integer, updated_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS outbound_jobs (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, message_id text REFERENCES messages(id) ON DELETE set null, domain_id text REFERENCES domains(id) ON DELETE set null, status text DEFAULT 'queued' NOT NULL, payload text NOT NULL, idempotency_key text, request_hash text, delivery_started_at integer, attempt_count integer DEFAULT 0 NOT NULL, error text, scheduled_at integer, send_not_before integer, canceled_at integer, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS outbound_jobs_user_idempotency_key_idx ON outbound_jobs(user_id, idempotency_key);
CREATE INDEX IF NOT EXISTS outbound_jobs_user_created_idx ON outbound_jobs(user_id, created_at);
CREATE INDEX IF NOT EXISTS outbound_jobs_domain_created_idx ON outbound_jobs(domain_id, created_at);
CREATE INDEX IF NOT EXISTS outbound_jobs_status_send_not_before_idx ON outbound_jobs(status, send_not_before);
CREATE TABLE IF NOT EXISTS sender_policies (id text PRIMARY KEY NOT NULL, user_id text REFERENCES users(id) ON DELETE cascade, pattern_type text NOT NULL, pattern text NOT NULL, action text NOT NULL, created_by_user_id text REFERENCES users(id) ON DELETE set null, created_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS sender_policies_scope_pattern_idx ON sender_policies(user_id, pattern_type, pattern);
CREATE INDEX IF NOT EXISTS sender_policies_lookup_idx ON sender_policies(user_id, pattern_type, pattern);
CREATE TABLE IF NOT EXISTS dead_letter_events (id text PRIMARY KEY NOT NULL, source_queue text NOT NULL, dead_letter_queue text NOT NULL, queue_message_id text NOT NULL, reference_id text, payload text NOT NULL, diagnostic_code text NOT NULL, attempt_count integer NOT NULL, status text DEFAULT 'unresolved' NOT NULL, replay_count integer DEFAULT 0 NOT NULL, message_created_at integer NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, replayed_at integer, replayed_by_user_id text REFERENCES users(id) ON DELETE set null);
CREATE UNIQUE INDEX IF NOT EXISTS dead_letter_events_queue_message_idx ON dead_letter_events(dead_letter_queue, queue_message_id);
CREATE INDEX IF NOT EXISTS dead_letter_events_status_created_idx ON dead_letter_events(status, created_at);
CREATE INDEX IF NOT EXISTS dead_letter_events_source_created_idx ON dead_letter_events(source_queue, created_at);
CREATE TABLE IF NOT EXISTS email_templates (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, name text NOT NULL, subject text DEFAULT '' NOT NULL, text_body text DEFAULT '' NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS email_templates_user_idx ON email_templates(user_id);
CREATE TABLE IF NOT EXISTS calendar_events (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, mailbox_id text REFERENCES mailboxes(id) ON DELETE set null, title text NOT NULL, description text DEFAULT '' NOT NULL, location text DEFAULT '' NOT NULL, attendees text DEFAULT '[]' NOT NULL, organizer text, starts_at integer NOT NULL, ends_at integer NOT NULL, timezone text DEFAULT 'UTC' NOT NULL, all_day integer DEFAULT 0 NOT NULL, sequence integer DEFAULT 0 NOT NULL, idempotency_key text, request_hash text, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS calendar_events_user_starts_idx ON calendar_events(user_id, starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_user_idempotency_idx ON calendar_events(user_id, idempotency_key);
 CREATE TABLE IF NOT EXISTS calendar_tasks (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, assignee_user_id text REFERENCES users(id) ON DELETE set null, completed_by_user_id text REFERENCES users(id) ON DELETE set null, assigned_at integer, mailbox_id text REFERENCES mailboxes(id) ON DELETE set null, title text NOT NULL, description text DEFAULT '' NOT NULL, due_at integer, timezone text DEFAULT 'UTC' NOT NULL, all_day integer DEFAULT 0 NOT NULL, status text DEFAULT 'open' NOT NULL CHECK (status IN ('open', 'completed')), priority text DEFAULT 'none' NOT NULL CHECK (priority IN ('none', 'low', 'medium', 'high')), completed_at integer, created_at integer NOT NULL, updated_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS calendar_tasks_user_status_due_idx ON calendar_tasks(user_id, status, due_at);
 CREATE INDEX IF NOT EXISTS calendar_tasks_user_due_idx ON calendar_tasks(user_id, due_at);
 CREATE INDEX IF NOT EXISTS calendar_tasks_assignee_status_due_idx ON calendar_tasks(assignee_user_id, status, due_at);
CREATE TABLE IF NOT EXISTS calendar_reminders (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, event_id text REFERENCES calendar_events(id) ON DELETE cascade, task_id text REFERENCES calendar_tasks(id) ON DELETE cascade, mailbox_id text REFERENCES mailboxes(id) ON DELETE set null, title text NOT NULL, message text DEFAULT '' NOT NULL, channel text DEFAULT 'in_app' NOT NULL CHECK (channel IN ('in_app', 'email')), recipient text, from_addr text, remind_at integer NOT NULL, timezone text DEFAULT 'UTC' NOT NULL, status text DEFAULT 'scheduled' NOT NULL CHECK (status IN ('scheduled', 'processing', 'delivered', 'dismissed', 'cancelled', 'failed')), snoozed_until integer, claimed_at integer, delivered_at integer, dismissed_at integer, attempt_count integer DEFAULT 0 NOT NULL, last_error text, created_at integer NOT NULL, updated_at integer NOT NULL, CHECK ((event_id IS NOT NULL AND task_id IS NULL) OR (event_id IS NULL AND task_id IS NOT NULL)), CHECK (channel = 'in_app' OR (mailbox_id IS NOT NULL AND recipient IS NOT NULL AND from_addr IS NOT NULL)));
CREATE INDEX IF NOT EXISTS calendar_reminders_due_idx ON calendar_reminders(status, remind_at);
CREATE INDEX IF NOT EXISTS calendar_reminders_user_status_idx ON calendar_reminders(user_id, status, remind_at);
CREATE INDEX IF NOT EXISTS calendar_reminders_event_idx ON calendar_reminders(event_id);
CREATE INDEX IF NOT EXISTS calendar_reminders_task_idx ON calendar_reminders(task_id);
CREATE TABLE IF NOT EXISTS calendar_reminder_deliveries (id text PRIMARY KEY NOT NULL, reminder_id text NOT NULL REFERENCES calendar_reminders(id) ON DELETE cascade, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, scheduled_for integer NOT NULL, channel text NOT NULL CHECK (channel IN ('in_app', 'email')), status text NOT NULL CHECK (status IN ('delivered', 'queued', 'failed')), idempotency_key text NOT NULL, outbound_job_id text REFERENCES outbound_jobs(id) ON DELETE set null, message_id text REFERENCES messages(id) ON DELETE set null, attempt_count integer DEFAULT 1 NOT NULL, error text, created_at integer NOT NULL, delivered_at integer);
CREATE UNIQUE INDEX IF NOT EXISTS calendar_reminder_deliveries_schedule_idx ON calendar_reminder_deliveries(reminder_id, scheduled_for);
CREATE INDEX IF NOT EXISTS calendar_reminder_deliveries_user_created_idx ON calendar_reminder_deliveries(user_id, created_at);
CREATE TABLE IF NOT EXISTS routing_rules (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, domain_id text NOT NULL REFERENCES domains(id) ON DELETE cascade, pattern text NOT NULL, match_field text DEFAULT 'email' NOT NULL, match_operator text DEFAULT 'contains' NOT NULL, match_value text DEFAULT '' NOT NULL, mailbox_id text REFERENCES mailboxes(id) ON DELETE set null, folder_id text REFERENCES folders(id) ON DELETE set null, action text DEFAULT 'store' NOT NULL, forward_to text, priority integer DEFAULT 0 NOT NULL, created_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS webhooks (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, url text NOT NULL, secret text NOT NULL, events text NOT NULL, enabled integer DEFAULT true NOT NULL, created_at integer NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_deliveries (id text PRIMARY KEY NOT NULL, webhook_id text NOT NULL REFERENCES webhooks(id) ON DELETE cascade, event_type text NOT NULL, payload text NOT NULL, status text DEFAULT 'pending' NOT NULL, attempts integer DEFAULT 0 NOT NULL, last_attempt_at integer, next_attempt_at integer, delivered_at integer, last_status_code integer, last_error text, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS webhook_deliveries_webhook_created_idx ON webhook_deliveries(webhook_id, created_at);
CREATE INDEX IF NOT EXISTS webhook_deliveries_status_next_idx ON webhook_deliveries(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, token_hash text NOT NULL UNIQUE, kind text DEFAULT 'authenticated' NOT NULL, authenticated_at integer, expires_at integer NOT NULL, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user_expires_idx ON sessions(user_id, expires_at);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_kind_expires_idx ON sessions(kind, expires_at);
CREATE TABLE IF NOT EXISTS account_recovery_tokens (id text PRIMARY KEY NOT NULL, user_id text NOT NULL REFERENCES users(id) ON DELETE cascade, purpose text NOT NULL, token_hash text NOT NULL, email text NOT NULL, expires_at integer NOT NULL, used_at integer, created_at integer NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS account_recovery_tokens_hash_idx ON account_recovery_tokens(token_hash);
CREATE INDEX IF NOT EXISTS account_recovery_tokens_user_purpose_idx ON account_recovery_tokens(user_id, purpose, created_at);
CREATE INDEX IF NOT EXISTS account_recovery_tokens_expires_idx ON account_recovery_tokens(expires_at);
CREATE TABLE IF NOT EXISTS audit_logs (id text PRIMARY KEY NOT NULL, actor_user_id text REFERENCES users(id) ON DELETE set null, target_user_id text REFERENCES users(id) ON DELETE set null, mailbox_id text REFERENCES mailboxes(id) ON DELETE set null, message_id text REFERENCES messages(id) ON DELETE set null, action text NOT NULL, metadata text, created_at integer NOT NULL);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS audit_logs_mailbox_idx ON audit_logs(mailbox_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS audit_logs_target_action_created_idx ON audit_logs(target_user_id, action, created_at);
CREATE TABLE IF NOT EXISTS backup_settings (id text PRIMARY KEY NOT NULL, enabled integer DEFAULT false NOT NULL, schedule_type text DEFAULT 'daily' NOT NULL, schedule_value integer, retention_enabled integer DEFAULT false NOT NULL, retention_days integer DEFAULT 30 NOT NULL, updated_at integer NOT NULL);
INSERT OR IGNORE INTO backup_settings (id, enabled, schedule_type, retention_enabled, retention_days, updated_at) VALUES ('default', false, 'daily', false, 30, unixepoch());
CREATE TABLE IF NOT EXISTS backups (id text PRIMARY KEY NOT NULL, status text DEFAULT 'queued' NOT NULL, trigger text NOT NULL, r2_key text, filename text, size integer, error text, created_by_user_id text REFERENCES users(id) ON DELETE set null, created_at integer NOT NULL, started_at integer, completed_at integer);
CREATE INDEX IF NOT EXISTS backups_created_idx ON backups(created_at);
CREATE INDEX IF NOT EXISTS backups_status_idx ON backups(status);
CREATE TABLE IF NOT EXISTS operational_settings (id text PRIMARY KEY NOT NULL, queue_backlog_warning integer DEFAULT 100 NOT NULL CHECK (queue_backlog_warning >= 1), queue_oldest_minutes_warning integer DEFAULT 15 NOT NULL CHECK (queue_oldest_minutes_warning >= 1), delivery_failed_24h_warning integer DEFAULT 1 NOT NULL CHECK (delivery_failed_24h_warning >= 1), delivery_unknown_24h_warning integer DEFAULT 1 NOT NULL CHECK (delivery_unknown_24h_warning >= 1), webhook_failed_24h_warning integer DEFAULT 1 NOT NULL CHECK (webhook_failed_24h_warning >= 1), reminder_failed_24h_warning integer DEFAULT 1 NOT NULL CHECK (reminder_failed_24h_warning >= 1), dead_letter_unresolved_warning integer DEFAULT 1 NOT NULL CHECK (dead_letter_unresolved_warning >= 1), backup_stale_hours integer DEFAULT 0 NOT NULL CHECK (backup_stale_hours >= 0), d1_growth_percent_warning integer DEFAULT 25 NOT NULL CHECK (d1_growth_percent_warning >= 1), r2_growth_percent_warning integer DEFAULT 25 NOT NULL CHECK (r2_growth_percent_warning >= 1), updated_at integer NOT NULL);
INSERT OR IGNORE INTO operational_settings (id, updated_at) VALUES ('default', unixepoch());
CREATE TABLE IF NOT EXISTS operational_snapshots (id text PRIMARY KEY NOT NULL, captured_at integer NOT NULL, d1_bytes integer NOT NULL CHECK (d1_bytes >= 0), r2_object_count integer NOT NULL CHECK (r2_object_count >= 0), r2_bytes integer NOT NULL CHECK (r2_bytes >= 0), r2_scan_complete integer DEFAULT true NOT NULL, inbound_backlog_count integer, inbound_backlog_bytes integer, inbound_oldest_at integer, outbound_backlog_count integer, outbound_backlog_bytes integer, outbound_oldest_at integer, webhook_backlog_count integer, webhook_backlog_bytes integer, webhook_oldest_at integer);
CREATE INDEX IF NOT EXISTS operational_snapshots_captured_idx ON operational_snapshots(captured_at DESC);
CREATE TABLE IF NOT EXISTS restore_drill_records (id text PRIMARY KEY NOT NULL, backup_id text REFERENCES backups(id) ON DELETE set null, environment text NOT NULL CHECK (environment IN ('staging', 'production')), source text NOT NULL CHECK (source IN ('staging-script', 'manual')), verified_by_user_id text REFERENCES users(id) ON DELETE set null, verified_at integer NOT NULL, d1_verified integer DEFAULT false NOT NULL, r2_verified integer DEFAULT false NOT NULL, rollback_verified integer DEFAULT false NOT NULL, sessions_invalidated integer DEFAULT false NOT NULL, cleanup_verified integer DEFAULT false NOT NULL);
CREATE INDEX IF NOT EXISTS restore_drill_records_verified_idx ON restore_drill_records(verified_at DESC);
CREATE TABLE IF NOT EXISTS app_settings (id text PRIMARY KEY NOT NULL, app_name text DEFAULT 'CC Mail' NOT NULL, company_name text DEFAULT '' NOT NULL, icon_key text, updated_at integer NOT NULL);
INSERT OR IGNORE INTO app_settings (id, app_name, updated_at) VALUES ('default', 'CC Mail', unixepoch());
CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);
`;

export async function migrateCleanDatabase(db: D1Database): Promise<boolean> {
	const existing = await db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT IN ('d1_migrations', 'd1_kv')",
		)
		.all<{ name: string }>();
	if (existing.results.length > 0) {
		const tableNames = new Set(existing.results.map((table) => table.name));
		if (tableNames.has("users") && tableNames.has("domains")) return false;
		throw new Error(
			"The D1 database is not empty, but the CC Mail schema is incomplete. Apply the committed D1 migrations before continuing setup.",
		);
	}

	const schemaStatements = INITIAL_SCHEMA_SQL.split(";")
		.map((statement) => statement.trim())
		.filter(Boolean)
		.map((statement) => db.prepare(statement));
	const migrationStatements = MIGRATION_NAMES.map((name) =>
		db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)").bind(name),
	);
	const searchSchemaStatements = SEARCH_SCHEMA_STATEMENTS.map((statement) => db.prepare(statement));
	const storageLifecycleStatements = STORAGE_LIFECYCLE_SCHEMA_STATEMENTS.map((statement) =>
		db.prepare(statement),
	);
	const accountLifecycleStatements = ACCOUNT_LIFECYCLE_SCHEMA_STATEMENTS.map((statement) =>
		db.prepare(statement),
	);
	await db.batch([
		...schemaStatements,
		...searchSchemaStatements,
		...storageLifecycleStatements,
		...accountLifecycleStatements,
		...migrationStatements,
	]);
	return true;
}
