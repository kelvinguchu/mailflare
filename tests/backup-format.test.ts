import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "../src/db/schema";
import {
	BACKUP_TABLES,
	DATABASE_BACKUP_FORMAT,
	DATABASE_BACKUP_VERSION,
	DATABASE_SYSTEM_TABLES,
	getUnclassifiedDatabaseTables,
	LEGACY_V1_BACKUP_TABLES,
	LEGACY_V2_V3_BACKUP_TABLES,
	LEGACY_V4_BACKUP_TABLES,
	LEGACY_V5_BACKUP_TABLES,
	LEGACY_V6_BACKUP_TABLES,
	LEGACY_V7_BACKUP_TABLES,
	LEGACY_V8_BACKUP_TABLES,
	LEGACY_V9_BACKUP_TABLES,
	LEGACY_V11_BACKUP_TABLES,
} from "../src/lib/backups/format";
import { normalizeDatabaseBackupDocument } from "../src/lib/backups/export";
import { createBackupFilename } from "../src/lib/backups/utils";

function emptyTables(
	tableNames: readonly string[],
): Record<string, Array<Record<string, unknown>>> {
	return Object.fromEntries(tableNames.map((table) => [table, []]));
}

describe("database backup format", () => {
	it("covers every table in the application schema", () => {
		const applicationTables = Object.values(schema).map((table) => getTableName(table));
		expect([...BACKUP_TABLES].sort()).toEqual(applicationTables.sort());
	});

	it("documents the database-owned tables that are intentionally excluded", () => {
		expect(DATABASE_SYSTEM_TABLES).toEqual([
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
		]);
	});

	it("reports an unclassified database table", () => {
		expect(
			getUnclassifiedDatabaseTables([
				...BACKUP_TABLES,
				...DATABASE_SYSTEM_TABLES,
				"new_application_table",
			]),
		).toEqual(["new_application_table"]);
	});

	it("keeps every legacy table catalog pinned to its original format", () => {
		expect(LEGACY_V1_BACKUP_TABLES).not.toEqual(
			expect.arrayContaining([
				"auto_reply_deliveries",
				"email_templates",
				"calendar_events",
				"dead_letter_events",
				"account_recovery_tokens",
				"sender_policies",
				"calendar_tasks",
				"calendar_reminders",
				"calendar_reminder_deliveries",
				"signature_assets",
			]),
		);
		expect(LEGACY_V2_V3_BACKUP_TABLES).not.toEqual(
			expect.arrayContaining([
				"dead_letter_events",
				"account_recovery_tokens",
				"sender_policies",
				"calendar_tasks",
				"signature_assets",
			]),
		);
		expect(LEGACY_V4_BACKUP_TABLES).not.toEqual(
			expect.arrayContaining([
				"account_recovery_tokens",
				"sender_policies",
				"calendar_tasks",
				"signature_assets",
			]),
		);
		expect(LEGACY_V5_BACKUP_TABLES).not.toEqual(
			expect.arrayContaining(["sender_policies", "calendar_tasks", "signature_assets"]),
		);
		expect(LEGACY_V6_BACKUP_TABLES).not.toEqual(
			expect.arrayContaining(["calendar_tasks", "signature_assets"]),
		);
		expect(LEGACY_V7_BACKUP_TABLES).not.toContain("signature_assets");
		expect(LEGACY_V9_BACKUP_TABLES).not.toContain("operational_settings");
		expect(LEGACY_V11_BACKUP_TABLES).not.toContain("mfa_policy_settings");
	});

	it("puts the format version in new backup filenames", () => {
		expect(createBackupFilename(new Date("2026-09-04T02:00:00.000Z"))).toBe(
			`cc-mail-v${DATABASE_BACKUP_VERSION}-2026-09-04T02-00-00-000Z.json`,
		);
	});

	it("normalizes legacy version 1 documents into the current format", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 1,
			createdAt: "2026-09-01T00:00:00.000Z",
			tables: emptyTables(LEGACY_V1_BACKUP_TABLES),
		});

		expect(document.version).toBe(DATABASE_BACKUP_VERSION);
		expect(document.sourceVersion).toBe(1);
		expect(document.r2.strategy).toBe("live-references");
		expect(document.tables.auto_reply_deliveries).toEqual([]);
		expect(document.tables.email_templates).toEqual([]);
		expect(document.tables.calendar_events).toEqual([]);
	});

	it("keeps version 2 backups restorable through live R2 references", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 2,
			createdAt: "2026-09-03T00:00:00.000Z",
			tables: emptyTables(LEGACY_V2_V3_BACKUP_TABLES),
		});

		expect(document.version).toBe(DATABASE_BACKUP_VERSION);
		expect(document.sourceVersion).toBe(2);
		expect(document.r2.strategy).toBe("live-references");
		expect(document.tables.dead_letter_events).toEqual([]);
	});

	it("keeps version 3 independent R2 backups restorable", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 3,
			createdAt: "2026-09-04T00:00:00.000Z",
			tables: emptyTables(LEGACY_V2_V3_BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});

		expect(document.sourceVersion).toBe(3);
		expect(document.r2).toEqual({ strategy: "independent-copies-v1", objects: [] });
		expect(document.tables.dead_letter_events).toEqual([]);
	});

	it("accepts the current format with an independent R2 manifest", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: DATABASE_BACKUP_VERSION,
			createdAt: "2026-09-04T00:00:00.000Z",
			tables: emptyTables(BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});

		expect(document.sourceVersion).toBe(DATABASE_BACKUP_VERSION);
		expect(document.r2).toEqual({ strategy: "independent-copies-v1", objects: [] });
	});

	it("normalizes version 5 backups without sender policies", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 5,
			createdAt: "2026-09-04T00:00:00.000Z",
			tables: emptyTables(LEGACY_V5_BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});
		expect(document.sourceVersion).toBe(5);
		expect(document.tables.sender_policies).toEqual([]);
	});

	it("normalizes version 6 backups without calendar tasks and reminders", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 6,
			createdAt: "2026-09-10T00:00:00.000Z",
			tables: emptyTables(LEGACY_V6_BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});
		expect(document.sourceVersion).toBe(6);
		expect(document.tables.calendar_tasks).toEqual([]);
		expect(document.tables.calendar_reminders).toEqual([]);
		expect(document.tables.calendar_reminder_deliveries).toEqual([]);
	});

	it("normalizes version 7 backups without rich signature assets", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 7,
			createdAt: "2026-09-14T00:00:00.000Z",
			tables: emptyTables(LEGACY_V7_BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});
		expect(document.sourceVersion).toBe(7);
		expect(document.tables.signature_assets).toEqual([]);
	});

	it("normalizes version 8 backups without storage lifecycle state", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 8,
			createdAt: "2026-09-15T00:00:00.000Z",
			tables: emptyTables(LEGACY_V8_BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});
		expect(document.sourceVersion).toBe(8);
		expect(document.tables.storage_deletion_jobs).toEqual([]);
		expect(document.tables.storage_lifecycle_state).toEqual([]);
	});

	it("normalizes version 9 backups without operational history", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 9,
			createdAt: "2026-09-15T00:00:00.000Z",
			tables: emptyTables(LEGACY_V9_BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});
		expect(document.sourceVersion).toBe(9);
		expect(document.tables.operational_settings).toEqual([]);
		expect(document.tables.operational_snapshots).toEqual([]);
		expect(document.tables.restore_drill_records).toEqual([]);
	});

	it("normalizes version 11 backups without MFA policy settings", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 11,
			createdAt: "2026-09-15T00:00:00.000Z",
			tables: emptyTables(LEGACY_V11_BACKUP_TABLES),
			r2: { strategy: "independent-copies-v1", objects: [] },
		});
		expect(document.sourceVersion).toBe(11);
		expect(document.tables.mfa_policy_settings).toEqual([]);
	});

	it("merges legacy message body rows while upgrading version 1", () => {
		const tables = emptyTables(LEGACY_V1_BACKUP_TABLES);
		tables.messages = [{ id: "msg_1" }];
		tables.message_bodies = [{ message_id: "msg_1", text_body: "Legacy body" }];

		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 1,
			createdAt: "2026-09-01T00:00:00.000Z",
			tables,
		});

		expect(document.tables.messages[0]?.text_body).toBe("Legacy body");
		expect("message_bodies" in document.tables).toBe(false);
	});

	it("rejects unsupported future versions", () => {
		expect(() =>
			normalizeDatabaseBackupDocument({
				format: DATABASE_BACKUP_FORMAT,
				version: DATABASE_BACKUP_VERSION + 1,
				createdAt: "2026-09-01T00:00:00.000Z",
				tables: emptyTables(BACKUP_TABLES),
			}),
		).toThrow("not a valid CC Mail backup");
	});

	it("rejects non-scalar record values before restoration", () => {
		const tables = emptyTables(BACKUP_TABLES);
		tables.users = [{ id: "user_1", name: { nested: "value" } }];

		expect(() =>
			normalizeDatabaseBackupDocument({
				format: DATABASE_BACKUP_FORMAT,
				version: DATABASE_BACKUP_VERSION,
				createdAt: "2026-09-04T00:00:00.000Z",
				tables,
			}),
		).toThrow("invalid users record");
	});
});
