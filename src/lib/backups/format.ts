export const DATABASE_BACKUP_FORMAT = "mailflare-database-backup";
export const DATABASE_BACKUP_VERSION = 12 as const;
export const MAX_DATABASE_RESTORE_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_OBJECTS = 5_000;
export const DATABASE_BACKUP_R2_STRATEGY = "independent-copies-v1" as const;

// Keep this list in foreign-key insertion order. Restore deletes it in reverse.
// The schema-coverage test requires every application table to have an entry.
export const BACKUP_TABLES = [
	"users",
	"mfa_policy_settings",
	"domains",
	"mailboxes",
	"signature_assets",
	"auto_reply_deliveries",
	"mailbox_access",
	"contacts",
	"folders",
	"api_keys",
	"messages",
	"message_attachments",
	"storage_deletion_jobs",
	"outbound_jobs",
	"sender_policies",
	"dead_letter_events",
	"email_templates",
	"calendar_events",
	"calendar_tasks",
	"calendar_reminders",
	"calendar_reminder_deliveries",
	"routing_rules",
	"webhooks",
	"webhook_deliveries",
	"sessions",
	"account_recovery_tokens",
	"audit_logs",
	"backup_settings",
	"backups",
	"operational_settings",
	"operational_snapshots",
	"restore_drill_records",
	"app_settings",
	"storage_lifecycle_state",
] as const;

const TABLE_INTRODUCED_IN_BACKUP_VERSION: Partial<Record<(typeof BACKUP_TABLES)[number], number>> =
	{
		auto_reply_deliveries: 2,
		email_templates: 2,
		calendar_events: 2,
		dead_letter_events: 4,
		account_recovery_tokens: 5,
		sender_policies: 6,
		calendar_tasks: 7,
		calendar_reminders: 7,
		calendar_reminder_deliveries: 7,
		signature_assets: 8,
		storage_deletion_jobs: 9,
		storage_lifecycle_state: 9,
		operational_settings: 10,
		operational_snapshots: 10,
		restore_drill_records: 10,
		mfa_policy_settings: 12,
	};

function getBackupTablesAvailableInVersion(version: number) {
	return BACKUP_TABLES.filter(
		(table) => (TABLE_INTRODUCED_IN_BACKUP_VERSION[table] ?? 1) <= version,
	);
}

export const LEGACY_V1_BACKUP_TABLES = getBackupTablesAvailableInVersion(1);
export const LEGACY_V2_V3_BACKUP_TABLES = getBackupTablesAvailableInVersion(2);
export const LEGACY_V4_BACKUP_TABLES = getBackupTablesAvailableInVersion(4);
export const LEGACY_V5_BACKUP_TABLES = getBackupTablesAvailableInVersion(5);
export const LEGACY_V6_BACKUP_TABLES = getBackupTablesAvailableInVersion(6);
export const LEGACY_V7_BACKUP_TABLES = getBackupTablesAvailableInVersion(7);
export const LEGACY_V8_BACKUP_TABLES = getBackupTablesAvailableInVersion(8);
export const LEGACY_V9_BACKUP_TABLES = getBackupTablesAvailableInVersion(9);
export const LEGACY_V10_BACKUP_TABLES = getBackupTablesAvailableInVersion(10);
export const LEGACY_V11_BACKUP_TABLES = getBackupTablesAvailableInVersion(11);

// These are D1/SQLite bookkeeping tables or derived FTS5 index tables, not
// source application data. Restore leaves them to D1, the migration runner,
// and the message-search triggers.
export const DATABASE_SYSTEM_TABLES = [
	"_cf_KV",
	"_cf_METADATA",
	"d1_migrations",
	"message_search",
	"message_search_config",
	"message_search_content",
	"message_search_data",
	"message_search_docsize",
	"message_search_idx",
	"sqlite_sequence",
	"sqlite_stat1",
] as const;

const CLASSIFIED_DATABASE_TABLES = new Set<string>([...BACKUP_TABLES, ...DATABASE_SYSTEM_TABLES]);

export function getUnclassifiedDatabaseTables(tableNames: readonly string[]): string[] {
	return tableNames.filter((table) => !CLASSIFIED_DATABASE_TABLES.has(table)).sort();
}
