import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createBackupBundle } from "@/lib/backups/bundle";
import {
	exportDatabaseDocument,
	serializeDatabaseBackup,
} from "@/lib/backups/export";
import {
	BACKUP_TABLES,
	DATABASE_BACKUP_FORMAT,
	LEGACY_V1_BACKUP_TABLES,
	LEGACY_V2_V3_BACKUP_TABLES,
	LEGACY_V4_BACKUP_TABLES,
} from "@/lib/backups/format";
import { restoreDatabaseRecords } from "@/lib/backups/restore";
import type { DatabaseBackupDocument, DatabaseRecord } from "@/lib/backups/types";
import { backupObjectContents, seedEveryBackupTable } from "./backup-fixtures";
import { integrationEnv } from "./bindings";
import { clearApplicationTables, resetIntegrationState } from "./fixtures";
import { migrateCleanDatabase } from "@/lib/setup/migration";

beforeEach(async () => {
	await resetIntegrationState();
});

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function serialize(document: DatabaseBackupDocument): ArrayBuffer {
	return arrayBuffer(serializeDatabaseBackup(document));
}

function emptyTables(names: readonly string[]): Record<string, DatabaseRecord[]> {
	return Object.fromEntries(names.map((name) => [name, []]));
}

describe("database backups with isolated D1 and R2", () => {
	it("round-trips every supported table and referenced object", async () => {
		await seedEveryBackupTable();
		const original = await exportDatabaseDocument(integrationEnv.DB);
		for (const table of BACKUP_TABLES) {
			expect(original.tables[table], `${table} fixture`).toHaveLength(1);
		}

		const bundle = await createBackupBundle(integrationEnv, "backup_round_trip", {
			now: new Date("2026-09-09T00:00:00Z"),
		});
		await clearApplicationTables();
		await integrationEnv.BUCKET.delete(Object.keys(backupObjectContents));
		const result = await restoreDatabaseRecords(integrationEnv, serialize(bundle.document));
		const restored = await exportDatabaseDocument(integrationEnv.DB);

		for (const table of BACKUP_TABLES) {
			if (table === "sessions" || table === "account_recovery_tokens" || table === "backups") continue;
			expect(restored.tables[table], table).toEqual(original.tables[table]);
		}
		expect(restored.tables.sessions).toEqual([]);
		expect(restored.tables.backups).toEqual(expect.arrayContaining(original.tables.backups));
		expect(restored.tables.backups).toContainEqual(expect.objectContaining({ id: result.recoveryBackupId }));
		expect(result.sessionsInvalidated).toBe(true);

		for (const [key, content] of Object.entries(backupObjectContents)) {
			expect(await (await integrationEnv.BUCKET.get(key))?.text(), key).toBe(content);
		}
		const stagingTables = await integrationEnv.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_cc_restore_%'",
		).all();
		expect(stagingTables.results).toEqual([]);
	});

	it("restores legacy versions 1 through 4 through the live D1 path", async () => {
		for (const version of [1, 2, 3, 4] as const) {
			const names = version === 1
				? LEGACY_V1_BACKUP_TABLES
				: version === 4
					? LEGACY_V4_BACKUP_TABLES
					: LEGACY_V2_V3_BACKUP_TABLES;
			const tables = emptyTables(names);
			tables.users = [{
				id: `legacy_user_${version}`,
				email: `legacy-${version}@example.test`,
				password_hash: "hash",
				name: `Legacy ${version}`,
				role: "user",
				disabled: 0,
				can_manage_mailboxes: 0,
				created_at: 1_700_000_000,
			}];
			const document = {
				format: DATABASE_BACKUP_FORMAT,
				version,
				createdAt: "2026-09-09T00:00:00.000Z",
				tables,
				...(version >= 3
					? { r2: { strategy: "independent-copies-v1" as const, objects: [] } }
					: {}),
			};

			await restoreDatabaseRecords(
				integrationEnv,
				new TextEncoder().encode(JSON.stringify(document)).buffer,
			);
			const user = await integrationEnv.DB.prepare(
				"SELECT id, name FROM users LIMIT 1",
			).first<{ id: string; name: string }>();
			expect(user).toEqual({ id: `legacy_user_${version}`, name: `Legacy ${version}` });
		}
	});

	it("rolls back R2 and preserves live rows when the final restore batch fails", async () => {
		await seedEveryBackupTable();
		const bundle = await createBackupBundle(integrationEnv, "backup_failure_source");
		await integrationEnv.DB.prepare("UPDATE users SET name = 'Current State' WHERE id = 'user_backup'").run();
		await integrationEnv.BUCKET.put("avatars/users/user.png", "current-avatar");
		const before = await exportDatabaseDocument(integrationEnv.DB);

		const corrupt = structuredClone(bundle.document);
		corrupt.tables.users.push({
			...corrupt.tables.users[0]!,
			id: "user_duplicate_email",
		});
		await expect(restoreDatabaseRecords(integrationEnv, serialize(corrupt)))
			.rejects.toThrow("UNIQUE constraint failed");
		const after = await exportDatabaseDocument(integrationEnv.DB);

		for (const table of BACKUP_TABLES) {
			if (table === "backups") continue;
			expect(after.tables[table], table).toEqual(before.tables[table]);
		}
		expect(after.tables.backups).toEqual(expect.arrayContaining(before.tables.backups));
		expect(after.tables.backups).toContainEqual(expect.objectContaining({
			id: expect.stringMatching(/^bak_restore_/),
		}));
		expect(await (await integrationEnv.BUCKET.get("avatars/users/user.png"))?.text())
			.toBe("current-avatar");
		const stagingTables = await integrationEnv.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_cc_restore_%'",
		).all();
		expect(stagingTables.results).toEqual([]);
	});
});

describe("D1 migration chain", () => {
	it("builds a clean setup schema equivalent to the migration chain", async () => {
		expect(await migrateCleanDatabase(integrationEnv.SETUP_DB)).toBe(true);
		expect(await migrateCleanDatabase(integrationEnv.SETUP_DB)).toBe(false);
		expect(await schemaManifest(integrationEnv.SETUP_DB)).toEqual(await schemaManifest(integrationEnv.DB));
		const migrations = await integrationEnv.SETUP_DB.prepare(
			"SELECT name FROM d1_migrations ORDER BY name",
		).all<{ name: string }>();
		expect(migrations.results.map((row) => row.name)).toEqual(
			integrationEnv.TEST_MIGRATIONS.map((migration) => migration.name).sort(),
		);
	});

	it("applies every migration to the preceding schema and matches the fresh schema", async () => {
		for (let index = 0; index < integrationEnv.TEST_MIGRATIONS.length; index += 1) {
			await applyD1Migrations(integrationEnv.MIGRATION_DB, [integrationEnv.TEST_MIGRATIONS[index]!]);
			const applied = await integrationEnv.MIGRATION_DB.prepare(
				"SELECT COUNT(*) AS count FROM d1_migrations",
			).first<{ count: number }>();
			expect(applied?.count).toBe(index + 1);
			const foreignKeyFailures = await integrationEnv.MIGRATION_DB.prepare("PRAGMA foreign_key_check").all();
			expect(foreignKeyFailures.results, integrationEnv.TEST_MIGRATIONS[index]!.name).toEqual([]);
		}

		const schemaQuery = `SELECT type, name, tbl_name, sql FROM sqlite_master
			WHERE type IN ('table', 'index')
			AND name NOT LIKE 'sqlite_%'
			AND name NOT LIKE '_cf_%'
			AND name != 'd1_migrations'
			ORDER BY type, name`;
		const upgraded = await integrationEnv.MIGRATION_DB.prepare(schemaQuery).all();
		const fresh = await integrationEnv.DB.prepare(schemaQuery).all();
		expect(upgraded.results).toEqual(fresh.results);
	});
});

async function schemaManifest(db: D1Database) {
	const tables = await db.prepare(`SELECT name FROM sqlite_master
		WHERE type = 'table'
		AND name NOT LIKE 'sqlite_%'
		AND name NOT LIKE '_cf_%'
		AND name != 'd1_migrations'
		ORDER BY name`).all<{ name: string }>();
	const manifest: Record<string, unknown> = {};
	for (const { name } of tables.results) {
		const columns = await db.prepare(`PRAGMA table_info('${name}')`).all();
		const indexes = await db.prepare(`PRAGMA index_list('${name}')`).all();
		const indexSignatures: Array<{ unique: unknown; columns: string[] }> = [];
		for (const index of indexes.results as Array<{ name: string; unique: unknown }>) {
			const details = await db.prepare(`PRAGMA index_info('${index.name}')`).all<{ name: string }>();
			indexSignatures.push({
				unique: index.unique,
				columns: details.results.map((column) => column.name),
			});
		}
		manifest[name] = {
			columns: columns.results.map(({ name: columnName, type, notnull, pk }) => ({
				name: columnName,
				type,
				notnull,
				pk,
			})).sort((left, right) => String(left.name).localeCompare(String(right.name))),
			indexes: indexSignatures.sort((left, right) =>
				JSON.stringify(left).localeCompare(JSON.stringify(right))),
		};
	}
	return manifest;
}
