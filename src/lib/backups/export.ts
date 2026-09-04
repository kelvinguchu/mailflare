import type { DatabaseBackupDocument, DatabaseBackupTable, DatabaseRecord } from "./types";
import {
	BACKUP_TABLES,
	DATABASE_BACKUP_FORMAT,
	DATABASE_BACKUP_VERSION,
	getUnclassifiedDatabaseTables,
	LEGACY_V1_BACKUP_TABLES,
} from "./format";
import { mergeLegacyMessageBodies } from "./utils";

export function getD1ExportConfigurationStatus(_env?: CloudflareEnv) {
	return { configured: true, missing: [] };
}

export async function exportDatabaseRecords(db: D1Database): Promise<Uint8Array> {
	await assertDatabaseBackupCoverage(db);
	const tables = {} as Record<DatabaseBackupTable, DatabaseRecord[]>;
	for (const table of BACKUP_TABLES) {
		const result = await db.prepare(`SELECT * FROM ${table}`).all<DatabaseRecord>();
		tables[table] = result.results;
	}
	const document: DatabaseBackupDocument = {
		format: DATABASE_BACKUP_FORMAT,
		version: DATABASE_BACKUP_VERSION,
		createdAt: new Date().toISOString(),
		tables,
	};
	return new TextEncoder().encode(JSON.stringify(document));
}

export function parseDatabaseBackup(content: ArrayBuffer): DatabaseBackupDocument {
	let value: unknown;
	try { value = JSON.parse(new TextDecoder().decode(content)); } catch { throw new Error("The selected file is not a valid CC Mail backup"); }
	return normalizeDatabaseBackupDocument(value);
}

export function normalizeDatabaseBackupDocument(value: unknown): DatabaseBackupDocument {
	if (!isRecord(value)) throw invalidBackupError();
	if (value.format !== DATABASE_BACKUP_FORMAT) throw invalidBackupError();
	if (value.version !== 1 && value.version !== DATABASE_BACKUP_VERSION) throw invalidBackupError();
	if (typeof value.createdAt !== "string" || !isRecord(value.tables)) throw invalidBackupError();

	const sourceTables = value.tables;
	const requiredTables = value.version === 1 ? LEGACY_V1_BACKUP_TABLES : BACKUP_TABLES;
	for (const table of requiredTables) validateTableRows(table, sourceTables[table]);

	const tables = {} as Record<DatabaseBackupTable, DatabaseRecord[]>;
	for (const table of BACKUP_TABLES) {
		const rows = sourceTables[table];
		if (rows === undefined && value.version === 1) {
			tables[table] = [];
			continue;
		}
		validateTableRows(table, rows);
		tables[table] = rows;
	}

	const document: DatabaseBackupDocument = {
		format: DATABASE_BACKUP_FORMAT,
		version: DATABASE_BACKUP_VERSION,
		createdAt: value.createdAt,
		tables,
	};
	const legacyBodies = sourceTables.message_bodies;
	if (legacyBodies !== undefined) {
		validateTableRows("message_bodies", legacyBodies);
		(document.tables as Record<string, DatabaseRecord[]>).message_bodies = legacyBodies;
		mergeLegacyMessageBodies(document);
	}
	return document;
}

function validateTableRows(table: string, value: unknown): asserts value is DatabaseRecord[] {
	if (!Array.isArray(value)) throw invalidBackupError();
	for (const row of value) {
		if (!isRecord(row)) throw new Error(`Backup contains an invalid ${table} record`);
		for (const columnValue of Object.values(row)) {
			if (columnValue !== null && typeof columnValue !== "string" && typeof columnValue !== "number") {
				throw new Error(`Backup contains an invalid ${table} record`);
			}
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function invalidBackupError(): Error {
	return new Error("The selected file is not a valid CC Mail backup");
}

export async function assertDatabaseBackupCoverage(db: D1Database): Promise<void> {
	const result = await db
		.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
		.all<{ name: string }>();
	const unclassified = getUnclassifiedDatabaseTables(result.results.map(({ name }) => name));
	if (unclassified.length > 0) {
		throw new Error(`Database backup policy is missing table(s): ${unclassified.join(", ")}`);
	}
}
