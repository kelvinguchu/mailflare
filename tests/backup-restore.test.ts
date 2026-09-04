import { describe, expect, it, vi } from "vitest";
import { BACKUP_TABLES } from "../src/lib/backups/format";
import type { DatabaseBackupTable } from "../src/lib/backups/types";
import {
	executeAtomicRestoreBatch,
	validateDatabaseBackupColumns,
	type TableColumn,
} from "../src/lib/backups/restore";
import { normalizeDatabaseBackupDocument } from "../src/lib/backups/export";

function validColumns(): Record<DatabaseBackupTable, TableColumn[]> {
	return Object.fromEntries(
		BACKUP_TABLES.map((table) => [table, [{ name: "id", type: "TEXT", notnull: 0, dflt_value: null, pk: 1 }]]),
	) as Record<DatabaseBackupTable, TableColumn[]>;
}

function documentWithUser(row: Record<string, string | number | null>) {
	const tables = Object.fromEntries(BACKUP_TABLES.map((table) => [table, []]));
	tables.users = [row];
	return normalizeDatabaseBackupDocument({
		format: "mailflare-database-backup",
		version: 2,
		createdAt: "2026-09-04T00:00:00.000Z",
		tables,
	});
}

describe("database restore transaction", () => {
	it("submits every live mutation in one D1 batch and propagates an injected failure", async () => {
		const statement = { bind: vi.fn() } as D1PreparedStatement;
		vi.mocked(statement.bind).mockReturnValue(statement);
		const injectedFailure = new Error("injected restore failure");
		const db = {
			prepare: vi.fn(() => statement),
			batch: vi.fn(async () => {
				throw injectedFailure;
			}),
		} as Pick<D1Database, "prepare" | "batch">;

		await expect(
			executeAtomicRestoreBatch(db, [
				{ sql: "DELETE FROM users" },
				{ sql: "INSERT INTO users (id) SELECT id FROM restore_users", values: ["user_1"] },
			]),
		).rejects.toBe(injectedFailure);

		expect(db.prepare).toHaveBeenCalledTimes(2);
		expect(db.batch).toHaveBeenCalledTimes(1);
		expect(db.batch).toHaveBeenCalledWith([statement, statement]);
	});

	it("rejects unknown columns before live tables are touched", () => {
		expect(() =>
			validateDatabaseBackupColumns(
				documentWithUser({ id: "user_1", unexpected: "value" }),
				validColumns(),
			),
		).toThrow("unknown column users.unexpected");
	});

	it("rejects a row missing a required primary-key column", () => {
		const columns = validColumns();
		columns.users.push({ name: "name", type: "TEXT", notnull: 1, dflt_value: "''", pk: 0 });
		expect(() =>
			validateDatabaseBackupColumns(
				documentWithUser({ name: "CaliberCode" }),
				columns,
			),
		).toThrow("missing required column users.id");
	});
});
