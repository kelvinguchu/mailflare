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
} from "../src/lib/backups/format";
import { normalizeDatabaseBackupDocument } from "../src/lib/backups/export";
import { createBackupFilename } from "../src/lib/backups/utils";

function emptyTables(tableNames: readonly string[]): Record<string, Array<Record<string, unknown>>> {
	return Object.fromEntries(tableNames.map((table) => [table, []]));
}

describe("database backup format", () => {
	it("covers every table in the application schema", () => {
		const applicationTables = Object.values(schema).map((table) => getTableName(table));
		expect([...BACKUP_TABLES].sort()).toEqual(applicationTables.sort());
	});

	it("documents the database-owned tables that are intentionally excluded", () => {
		expect(DATABASE_SYSTEM_TABLES).toEqual(["_cf_KV", "d1_migrations", "sqlite_sequence"]);
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

	it("puts the format version in new backup filenames", () => {
		expect(createBackupFilename(new Date("2026-09-04T02:00:00.000Z"))).toBe(
			"cc-mail-v2-2026-09-04T02-00-00-000Z.json",
		);
	});

	it("normalizes legacy version 1 documents into version 2", () => {
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: 1,
			createdAt: "2026-09-01T00:00:00.000Z",
			tables: emptyTables(LEGACY_V1_BACKUP_TABLES),
		});

		expect(document.version).toBe(DATABASE_BACKUP_VERSION);
		expect(document.tables.auto_reply_deliveries).toEqual([]);
		expect(document.tables.email_templates).toEqual([]);
		expect(document.tables.calendar_events).toEqual([]);
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
				version: 3,
				createdAt: "2026-09-01T00:00:00.000Z",
				tables: emptyTables(BACKUP_TABLES),
			}),
		).toThrow("not a valid CC Mail backup");
	});
});
