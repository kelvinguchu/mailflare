import { applyD1Migrations } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createBackupBundle } from "@/lib/backups/bundle";
import { exportDatabaseDocument, serializeDatabaseBackup } from "@/lib/backups/export";
import {
	BACKUP_TABLES,
	DATABASE_BACKUP_FORMAT,
	LEGACY_V1_BACKUP_TABLES,
	LEGACY_V2_V3_BACKUP_TABLES,
	LEGACY_V4_BACKUP_TABLES,
	LEGACY_V5_BACKUP_TABLES,
	LEGACY_V6_BACKUP_TABLES,
	LEGACY_V7_BACKUP_TABLES,
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
			if (table === "sessions" || table === "account_recovery_tokens" || table === "backups")
				continue;
			expect(restored.tables[table], table).toEqual(original.tables[table]);
		}
		expect(restored.tables.sessions).toEqual([]);
		expect(restored.tables.backups).toEqual(expect.arrayContaining(original.tables.backups));
		expect(restored.tables.backups).toContainEqual(
			expect.objectContaining({ id: result.recoveryBackupId }),
		);
		expect(result.sessionsInvalidated).toBe(true);

		for (const [key, content] of Object.entries(backupObjectContents)) {
			expect(await (await integrationEnv.BUCKET.get(key))?.text(), key).toBe(content);
		}
		const stagingTables = await integrationEnv.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_cc_restore_%'",
		).all();
		expect(stagingTables.results).toEqual([]);
	});

	it("restores legacy versions 1 through 7 through the live D1 path", async () => {
		for (const version of [1, 2, 3, 4, 5, 6, 7] as const) {
			const names =
				version === 1
					? LEGACY_V1_BACKUP_TABLES
					: version === 4
						? LEGACY_V4_BACKUP_TABLES
						: version === 5
							? LEGACY_V5_BACKUP_TABLES
							: version === 6
								? LEGACY_V6_BACKUP_TABLES
								: version === 7
									? LEGACY_V7_BACKUP_TABLES
									: LEGACY_V2_V3_BACKUP_TABLES;
			const tables = emptyTables(names);
			tables.users = [
				{
					id: `legacy_user_${version}`,
					email: `legacy-${version}@example.test`,
					password_hash: "hash",
					name: `Legacy ${version}`,
					role: "user",
					disabled: 0,
					can_manage_mailboxes: 0,
					created_at: 1_700_000_000,
				},
			];
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
			const user = await integrationEnv.DB.prepare("SELECT id, name FROM users LIMIT 1").first<{
				id: string;
				name: string;
			}>();
			expect(user).toEqual({ id: `legacy_user_${version}`, name: `Legacy ${version}` });
		}
	});

	it("rolls back R2 and preserves live rows when the final restore batch fails", async () => {
		await seedEveryBackupTable();
		const bundle = await createBackupBundle(integrationEnv, "backup_failure_source");
		await integrationEnv.DB.prepare(
			"UPDATE users SET name = 'Current State' WHERE id = 'user_backup'",
		).run();
		await integrationEnv.BUCKET.put("avatars/users/user.png", "current-avatar");
		const before = await exportDatabaseDocument(integrationEnv.DB);

		const corrupt = structuredClone(bundle.document);
		corrupt.tables.users.push({
			...corrupt.tables.users[0]!,
			id: "user_duplicate_email",
		});
		await expect(restoreDatabaseRecords(integrationEnv, serialize(corrupt))).rejects.toThrow(
			"UNIQUE constraint failed",
		);
		const after = await exportDatabaseDocument(integrationEnv.DB);

		for (const table of BACKUP_TABLES) {
			if (table === "backups") continue;
			expect(after.tables[table], table).toEqual(before.tables[table]);
		}
		expect(after.tables.backups).toEqual(expect.arrayContaining(before.tables.backups));
		expect(after.tables.backups).toContainEqual(
			expect.objectContaining({
				id: expect.stringMatching(/^bak_restore_/),
			}),
		);
		expect(await (await integrationEnv.BUCKET.get("avatars/users/user.png"))?.text()).toBe(
			"current-avatar",
		);
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
		expect(await schemaManifest(integrationEnv.SETUP_DB)).toEqual(
			await schemaManifest(integrationEnv.DB),
		);
		const migrations = await integrationEnv.SETUP_DB.prepare(
			"SELECT name FROM d1_migrations ORDER BY name",
		).all<{ name: string }>();
		expect(migrations.results.map((row) => row.name)).toEqual(
			integrationEnv.TEST_MIGRATIONS.map((migration) => migration.name).sort(),
		);
	});

	it("applies every migration to the preceding schema and matches the fresh schema", async () => {
		for (let index = 0; index < integrationEnv.TEST_MIGRATIONS.length; index += 1) {
			const migration = integrationEnv.TEST_MIGRATIONS[index]!;
			if (migration.name.includes("0039_add_conversation_threads")) {
				await seedPreThreadMigrationMessages(integrationEnv.MIGRATION_DB);
			}
			await applyD1Migrations(integrationEnv.MIGRATION_DB, [migration]);
			const applied = await integrationEnv.MIGRATION_DB.prepare(
				"SELECT COUNT(*) AS count FROM d1_migrations",
			).first<{ count: number }>();
			expect(applied?.count).toBe(index + 1);
			const foreignKeyFailures = await integrationEnv.MIGRATION_DB.prepare(
				"PRAGMA foreign_key_check",
			).all();
			expect(foreignKeyFailures.results, integrationEnv.TEST_MIGRATIONS[index]!.name).toEqual([]);
			if (migration.name.includes("0039_add_conversation_threads")) {
				const rows = await integrationEnv.MIGRATION_DB.prepare(
					"SELECT id, thread_id, provider_message_id FROM messages ORDER BY created_at",
				).all<{ id: string; thread_id: string; provider_message_id: string }>();
				expect(rows.results[0]?.thread_id).toMatch(/^thr_/);
				expect(rows.results[1]?.thread_id).toBe(rows.results[0]?.thread_id);
				expect(rows.results[1]?.provider_message_id).toBe("<legacy_outbound@primary.test>");
			}
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

async function seedPreThreadMigrationMessages(db: D1Database): Promise<void> {
	await db.batch([
		db.prepare(
			`INSERT INTO users (id, email, password_hash, name, role, created_at)
			 VALUES ('legacy_owner', 'owner@primary.test', 'hash', 'Owner', 'admin', 1700000000)`,
		),
		db.prepare(
			`INSERT INTO domains
			 (id, user_id, hostname, zone_id, status, sending_enabled, routing_enabled, created_at)
			 VALUES ('legacy_domain', 'legacy_owner', 'primary.test', 'zone', 'active', 1, 1, 1700000000)`,
		),
		db.prepare(
			`INSERT INTO mailboxes
			 (id, user_id, domain_id, local_part, type, disabled, created_at)
			 VALUES ('legacy_mailbox', 'legacy_owner', 'legacy_domain', 'support', 'personal', 0, 1700000000)`,
		),
		db.prepare(
			`INSERT INTO messages
			 (id, user_id, mailbox_id, direction, provider_message_id, from_addr, to_addr,
			  subject, status, created_at)
			 VALUES ('legacy_inbound', 'legacy_owner', 'legacy_mailbox', 'inbound',
			  'legacy-inbound@example.net', 'maya@example.net', 'support@primary.test',
			  'Quarterly status', 'received', 1700000100)`,
		),
		db.prepare(
			`INSERT INTO messages
			 (id, user_id, mailbox_id, direction, from_addr, to_addr, subject, status, created_at)
			 VALUES ('legacy_outbound', 'legacy_owner', 'legacy_mailbox', 'outbound',
			  'support@primary.test', 'maya@example.net', 'Re: Quarterly status', 'sent', 1700000200)`,
		),
	]);
}

async function schemaManifest(db: D1Database) {
	const tables = await db
		.prepare(
			`SELECT name FROM sqlite_master
		WHERE type = 'table'
		AND name NOT LIKE 'sqlite_%'
		AND name NOT LIKE '_cf_%'
		AND name != 'd1_migrations'
		ORDER BY name`,
		)
		.all<{ name: string }>();
	const manifest: Record<string, unknown> = {};
	for (const { name } of tables.results) {
		const columns = await db.prepare(`PRAGMA table_info('${name}')`).all();
		const indexes = await db.prepare(`PRAGMA index_list('${name}')`).all();
		const indexSignatures: Array<{ unique: unknown; columns: string[] }> = [];
		for (const index of indexes.results as Array<{ name: string; unique: unknown }>) {
			const details = await db
				.prepare(`PRAGMA index_info('${index.name}')`)
				.all<{ name: string }>();
			indexSignatures.push({
				unique: index.unique,
				columns: details.results.map((column) => column.name),
			});
		}
		manifest[name] = {
			columns: columns.results
				.map(({ name: columnName, type, notnull, pk }) => ({
					name: columnName,
					type,
					notnull,
					pk,
				}))
				.sort((left, right) => String(left.name).localeCompare(String(right.name))),
			indexes: indexSignatures.sort((left, right) =>
				JSON.stringify(left).localeCompare(JSON.stringify(right)),
			),
		};
	}
	return manifest;
}
