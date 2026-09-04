export const DATABASE_BACKUP_FORMAT = "mailflare-database-backup";
export const DATABASE_BACKUP_VERSION = 3 as const;
export const MAX_DATABASE_RESTORE_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_OBJECTS = 5_000;
export const DATABASE_BACKUP_R2_STRATEGY = "independent-copies-v1" as const;

// Keep this list in foreign-key insertion order. Restore deletes it in reverse.
// The schema-coverage test requires every application table to have an entry.
export const BACKUP_TABLES = [
	"users",
	"domains",
	"mailboxes",
	"auto_reply_deliveries",
	"mailbox_access",
	"contacts",
	"folders",
	"api_keys",
	"messages",
	"message_attachments",
	"outbound_jobs",
	"email_templates",
	"calendar_events",
	"routing_rules",
	"webhooks",
	"webhook_deliveries",
	"sessions",
	"audit_logs",
	"backup_settings",
	"backups",
	"app_settings",
] as const;

// Version 1 omitted these three application tables. When restoring a v1
// document they are deliberately initialized empty because the lost rows
// cannot be reconstructed from that format.
export const LEGACY_V1_BACKUP_TABLES = BACKUP_TABLES.filter(
	(table) =>
		table !== "auto_reply_deliveries" &&
		table !== "email_templates" &&
		table !== "calendar_events",
);

// These are D1/SQLite bookkeeping tables, not application data. D1 and the
// migration runner own them, so application-level restore must not overwrite
// them.
export const DATABASE_SYSTEM_TABLES = ["_cf_KV", "d1_migrations", "sqlite_sequence"] as const;

const CLASSIFIED_DATABASE_TABLES = new Set<string>([
	...BACKUP_TABLES,
	...DATABASE_SYSTEM_TABLES,
]);

export function getUnclassifiedDatabaseTables(tableNames: readonly string[]): string[] {
	return tableNames.filter((table) => !CLASSIFIED_DATABASE_TABLES.has(table)).sort();
}
