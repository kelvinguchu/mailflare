import { integrationEnv } from "./bindings";

export const backupObjectContents = {
	"avatars/users/user.png": "user-avatar",
	"avatars/mailboxes/mailbox.png": "mailbox-avatar",
	"raw/messages/message.eml": "raw-email",
	"attachments/message/attachment.txt": "attachment",
	"branding/app/icon.png": "branding-icon",
} as const;

const timestamp = 1_700_000_000;

export async function seedEveryBackupTable(): Promise<void> {
	const db = integrationEnv.DB;
	await db.batch([
		db.prepare(`INSERT INTO users
			(id, email, password_hash, name, avatar_key, role, disabled, can_manage_mailboxes, created_at)
			VALUES ('user_backup', 'backup@example.test', 'hash', 'Backup User', 'avatars/users/user.png', 'admin', 0, 1, ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO domains
			(id, user_id, hostname, zone_id, status, sending_enabled, routing_enabled, created_at)
			VALUES ('domain_backup', 'user_backup', 'example.test', 'zone', 'active', 1, 1, ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO mailboxes
			(id, user_id, domain_id, local_part, display_name, avatar_key, type, use_all_domains, disabled,
			 auto_reply_enabled, auto_reply_subject, auto_reply_body, created_at)
			VALUES ('mailbox_backup', 'user_backup', 'domain_backup', 'backup', 'Backup Mailbox',
			 'avatars/mailboxes/mailbox.png', 'shared', 1, 0, 1, 'Away', 'Later', ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO auto_reply_deliveries
			(id, mailbox_id, recipient, sent_at) VALUES ('reply_backup', 'mailbox_backup', 'recipient@example.net', ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO mailbox_access
			(id, mailbox_id, user_id, permission, created_by_user_id, created_at)
			VALUES ('access_backup', 'mailbox_backup', 'user_backup', 'full_access', 'user_backup', ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO contacts
			(id, user_id, email, display_name, source, blocked, last_seen_at, created_at)
			VALUES ('contact_backup', 'user_backup', 'contact@example.net', 'Contact', 'manual', 0, ?, ?)`)
			.bind(timestamp, timestamp),
		db.prepare(`INSERT INTO folders
			(id, user_id, mailbox_id, name, color, created_at)
			VALUES ('folder_backup', 'user_backup', 'mailbox_backup', 'Archive', '#123456', ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO api_keys
			(id, user_id, name, prefix, key_hash, scopes, created_at, last_used_at)
			VALUES ('key_backup', 'user_backup', 'Automation', 'cc_test', 'key-hash', '["send"]', ?, ?)`)
			.bind(timestamp, timestamp),
		db.prepare(`INSERT INTO messages
			(id, user_id, mailbox_id, direction, provider_message_id, folder_id, from_addr, to_addr,
			 subject, snippet, text_body, html_body, raw_r2_key, inbound_delivery_key, status, read,
			 starred, snoozed_until, thread_id, created_at)
			VALUES ('message_backup', 'user_backup', 'mailbox_backup', 'inbound', 'provider-id', 'folder_backup',
			 'sender@example.net', 'backup@example.test', 'Subject', 'Snippet', 'Text', '<p>Text</p>',
			 'raw/messages/message.eml', ?, 'received', 1, 1, ?, 'thread_backup', ?)`)
			.bind("a".repeat(64), timestamp + 3600, timestamp),
		db.prepare(`INSERT INTO message_attachments
			(id, message_id, filename, content_type, size, disposition, content_id, r2_key, created_at)
			VALUES ('attachment_backup', 'message_backup', 'attachment.txt', 'text/plain', 10,
			 'attachment', NULL, 'attachments/message/attachment.txt', ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO outbound_jobs
			(id, user_id, message_id, status, payload, idempotency_key, request_hash, attempt_count,
			 error, scheduled_at, created_at, updated_at)
			VALUES ('job_backup', 'user_backup', 'message_backup', 'failed', '{}', 'idempotency-backup',
			 'request-hash', 2, 'E_TEST', ?, ?, ?)`)
			.bind(timestamp, timestamp, timestamp),
		db.prepare(`INSERT INTO dead_letter_events
			(id, source_queue, dead_letter_queue, queue_message_id, reference_id, payload, diagnostic_code,
			 attempt_count, status, replay_count, message_created_at, created_at, updated_at)
			VALUES ('dead_backup', 'inbound', 'inbound-dlq', 'queue-message', 'message_backup', '{}',
			 'E_TEST', 4, 'unresolved', 0, ?, ?, ?)`)
			.bind(timestamp, timestamp, timestamp),
		db.prepare(`INSERT INTO email_templates
			(id, user_id, name, subject, text_body, created_at, updated_at)
			VALUES ('template_backup', 'user_backup', 'Template', 'Template subject', 'Template body', ?, ?)`)
			.bind(timestamp, timestamp),
		db.prepare(`INSERT INTO calendar_events
			(id, user_id, mailbox_id, title, description, location, attendees, starts_at, ends_at, created_at, updated_at)
			VALUES ('calendar_backup', 'user_backup', 'mailbox_backup', 'Meeting', 'Description', 'Office',
			 '["person@example.net"]', ?, ?, ?, ?)`)
			.bind(timestamp + 7200, timestamp + 10800, timestamp, timestamp),
		db.prepare(`INSERT INTO routing_rules
			(id, user_id, domain_id, pattern, match_field, match_operator, match_value, mailbox_id,
			 folder_id, action, priority, created_at)
			VALUES ('rule_backup', 'user_backup', 'domain_backup', 'sender@example.net', 'email', 'exact',
			 'sender@example.net', 'mailbox_backup', 'folder_backup', 'store', 10, ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO webhooks
			(id, user_id, url, secret, events, enabled, created_at)
			VALUES ('webhook_backup', 'user_backup', 'https://example.test/hook', 'secret',
			 '["message.inbound"]', 1, ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO webhook_deliveries
			(id, webhook_id, event_type, payload, status, attempts, created_at)
			VALUES ('delivery_backup', 'webhook_backup', 'message.inbound', '{}', 'delivered', 1, ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO sessions
			(id, user_id, token_hash, expires_at, created_at)
			VALUES ('session_backup', 'user_backup', 'token-hash', ?, ?)`)
			.bind(timestamp + 86400, timestamp),
		db.prepare(`INSERT INTO audit_logs
			(id, actor_user_id, target_user_id, mailbox_id, message_id, action, metadata, created_at)
			VALUES ('audit_backup', 'user_backup', 'user_backup', 'mailbox_backup', 'message_backup',
			 'fixture.created', '{}', ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO backup_settings
			(id, enabled, schedule_type, schedule_value, retention_enabled, retention_days, updated_at)
			VALUES ('settings_backup', 1, 'weekly', 2, 1, 14, ?)`)
			.bind(timestamp),
		db.prepare(`INSERT INTO backups
			(id, status, trigger, filename, size, created_by_user_id, created_at, started_at, completed_at)
			VALUES ('backup_history', 'completed', 'manual', 'history.json', 123, 'user_backup', ?, ?, ?)`)
			.bind(timestamp, timestamp, timestamp),
		db.prepare(`INSERT INTO app_settings
			(id, app_name, company_name, icon_key, updated_at)
			VALUES ('app_backup', 'CC Mail Test', 'Test Company', 'branding/app/icon.png', ?)`)
			.bind(timestamp),
	]);

	await Promise.all(Object.entries(backupObjectContents).map(([key, content]) =>
		integrationEnv.BUCKET.put(key, content, {
			httpMetadata: { contentType: key.endsWith(".png") ? "image/png" : "text/plain" },
			customMetadata: { fixture: "backup-round-trip" },
		}),
	));
}
