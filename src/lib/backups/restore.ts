import type {
	DatabaseBackupDocument,
	DatabaseBackupTable,
	DatabaseRecord,
	NormalizedDatabaseBackupDocument,
} from "./types";
import {
	BACKUP_TABLES,
	MAX_DATABASE_RESTORE_BYTES,
} from "./format";
import {
	assertDatabaseBackupCoverage,
	parseDatabaseBackup,
} from "./export";
import { createBackupBundle } from "./bundle";
import {
	deleteBackupBundle,
	restoreDatabaseBackupObjects,
	rollbackDatabaseBackupObjects,
	validateDatabaseBackupObjects,
} from "./objects";

const D1_MAX_BOUND_PARAMETERS = 100;
const MAX_STAGING_INSERT_STATEMENTS = 700;
const STAGING_BATCH_SIZE = 25;

export type TableColumn = {
	name: string;
	type: string;
	notnull: number;
	dflt_value: string | null;
	pk: number;
};

type RestoreSqlStatement = {
	sql: string;
	values?: readonly (string | number | null)[];
};

type RecoveryBackup = {
	id: string;
	filename: string;
	r2Key: string;
	size: number;
	document: DatabaseBackupDocument;
};

export type DatabaseRestoreResult = {
	recoveryBackupId: string;
	sessionsInvalidated: true;
};

export async function restoreDatabaseRecords(
	env: Pick<CloudflareEnv, "DB" | "BUCKET">,
	content: ArrayBuffer,
): Promise<DatabaseRestoreResult> {
	if (content.byteLength > MAX_DATABASE_RESTORE_BYTES) throw restoreTooLargeError();

	const document = parseDatabaseBackup(content);
	await assertDatabaseBackupCoverage(env.DB);
	const tableColumns = await getLiveTableColumns(env.DB);
	const selectedColumns = validateDatabaseBackupColumns(document, tableColumns);
	await validateDatabaseBackupObjects(env.BUCKET, document);

	// This snapshot is made before staging or live mutation. It remains in R2
	// and in backup history whether the restore transaction succeeds or fails.
	const recovery = await createRecoveryBackup(env);
	const restoreId = crypto.randomUUID().replaceAll("-", "");
	const stagingTables = Object.fromEntries(
		BACKUP_TABLES.map((table) => [table, `_cc_restore_${restoreId}_${table}`]),
	) as Record<DatabaseBackupTable, string>;

	const mutatedObjectKeys: string[] = [];
	try {
		await createStagingTables(env.DB, stagingTables);
		await loadStagingTables(env.DB, document, stagingTables, selectedColumns);
		try {
			await restoreDatabaseBackupObjects(
				env.BUCKET,
				document,
				(sourceKey) => mutatedObjectKeys.push(sourceKey),
			);
			const finalStatements = createFinalRestoreStatements(
				document,
				stagingTables,
				selectedColumns,
				recovery,
			);
			await executeAtomicRestoreBatch(env.DB, finalStatements);
		} catch (error) {
			try {
				await rollbackDatabaseBackupObjects(env.BUCKET, mutatedObjectKeys, recovery.document);
			} catch (rollbackError) {
				console.error(JSON.stringify({
					event: "database_restore_object_rollback_failed",
					recoveryBackupId: recovery.id,
					error: rollbackError instanceof Error ? rollbackError.message : "Unknown rollback error",
				}));
				throw new Error(
					`Restore failed and R2 rollback needs intervention. Recovery backup: ${recovery.id}`,
					{ cause: error },
				);
			}
			throw error;
		}
		return { recoveryBackupId: recovery.id, sessionsInvalidated: true };
	} finally {
		try {
			await dropStagingTables(env.DB, stagingTables);
		} catch (error) {
			console.error(JSON.stringify({
				event: "database_restore_staging_cleanup_failed",
				restoreId,
				error: error instanceof Error ? error.message : "Unknown cleanup error",
			}));
		}
	}
}

async function getLiveTableColumns(
	db: D1Database,
): Promise<Record<DatabaseBackupTable, TableColumn[]>> {
	const results = await db.batch<TableColumn>(
		BACKUP_TABLES.map((table) => db.prepare(`PRAGMA table_info(${quoteString(table)})`)),
	);
	const columns = {} as Record<DatabaseBackupTable, TableColumn[]>;
	for (let index = 0; index < BACKUP_TABLES.length; index += 1) {
		const table = BACKUP_TABLES[index];
		const result = results[index];
		if (!table || !result || result.results.length === 0) {
			throw new Error(`Database is missing the required ${table ?? "unknown"} table`);
		}
		columns[table] = result.results;
	}
	return columns;
}

export function validateDatabaseBackupColumns(
	document: NormalizedDatabaseBackupDocument,
	tableColumns: Record<DatabaseBackupTable, TableColumn[]>,
): Record<DatabaseBackupTable, string[]> {
	const selected = {} as Record<DatabaseBackupTable, string[]>;
	for (const table of BACKUP_TABLES) {
		const rows = document.tables[table];
		const liveColumns = tableColumns[table];
		const liveByName = new Map(liveColumns.map((column) => [column.name, column]));
		if (rows.length === 0) {
			selected[table] = [];
			continue;
		}

		const columns = Object.keys(rows[0] ?? {});
		if (columns.length === 0) throw new Error(`Backup contains an invalid ${table} record`);
		const canonicalColumns = [...columns].sort().join("\u0000");
		for (const row of rows) {
			if ([...Object.keys(row)].sort().join("\u0000") !== canonicalColumns) {
				throw new Error(`Backup contains inconsistent columns in ${table}`);
			}
			for (const column of columns) {
				const definition = liveByName.get(column);
				if (!definition) throw new Error(`Backup contains unknown column ${table}.${column}`);
				validateColumnValue(table, definition, row[column]);
			}
		}

		for (const definition of liveColumns) {
			const required = definition.pk > 0 || (definition.notnull === 1 && definition.dflt_value === null);
			if (required && !columns.includes(definition.name)) {
				throw new Error(`Backup is missing required column ${table}.${definition.name}`);
			}
		}
		selected[table] = columns;
	}
	return selected;
}

function validateColumnValue(table: DatabaseBackupTable, column: TableColumn, value: DatabaseRecord[string]): void {
	if (value === null) {
		if (column.pk > 0 || column.notnull === 1) {
			throw new Error(`Backup contains null for required column ${table}.${column.name}`);
		}
		return;
	}

	const declaredType = column.type.toUpperCase();
	if (declaredType.includes("INT")) {
		if (typeof value !== "number" || !Number.isSafeInteger(value)) throw invalidColumnTypeError(table, column.name);
		return;
	}
	if (declaredType.includes("REAL") || declaredType.includes("FLOA") || declaredType.includes("DOUB") || declaredType.includes("NUM")) {
		if (typeof value !== "number" || !Number.isFinite(value)) throw invalidColumnTypeError(table, column.name);
		return;
	}
	if (declaredType.includes("BLOB")) {
		throw new Error(`Backup restore does not support BLOB column ${table}.${column.name}`);
	}
	if (typeof value !== "string") throw invalidColumnTypeError(table, column.name);
}

function invalidColumnTypeError(table: DatabaseBackupTable, column: string): Error {
	return new Error(`Backup contains an invalid value for ${table}.${column}`);
}

async function createRecoveryBackup(
	env: Pick<CloudflareEnv, "DB" | "BUCKET">,
): Promise<RecoveryBackup> {
	const id = `bak_restore_${crypto.randomUUID().replaceAll("-", "")}`;
	const bundle = await createBackupBundle(env, id, {
		purpose: "pre-restore-recovery",
	});
	const recovery = {
		id,
		filename: bundle.filename,
		r2Key: bundle.r2Key,
		size: bundle.totalSize,
		document: bundle.document,
	};
	try {
		await env.DB.prepare(recoveryBackupInsertSql()).bind(...recoveryBackupValues(recovery)).run();
	} catch (error) {
		try {
			await deleteBackupBundle(env.BUCKET, id);
		} catch (cleanupError) {
			console.error(JSON.stringify({
				event: "database_restore_recovery_bundle_cleanup_failed",
				backupId: id,
				error: cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error",
			}));
		}
		throw error;
	}
	return recovery;
}

async function createStagingTables(
	db: D1Database,
	stagingTables: Record<DatabaseBackupTable, string>,
): Promise<void> {
	await db.batch(
		BACKUP_TABLES.map((table) =>
			db.prepare(`CREATE TABLE ${quoteIdentifier(stagingTables[table])} AS SELECT * FROM ${quoteIdentifier(table)} WHERE 0`),
		),
	);
}

async function loadStagingTables(
	db: D1Database,
	document: NormalizedDatabaseBackupDocument,
	stagingTables: Record<DatabaseBackupTable, string>,
	selectedColumns: Record<DatabaseBackupTable, string[]>,
): Promise<void> {
	const statements: D1PreparedStatement[] = [];
	for (const table of BACKUP_TABLES) {
		const columns = selectedColumns[table];
		if (columns.length === 0) continue;
		const rowsPerStatement = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMETERS / columns.length));
		for (let index = 0; index < document.tables[table].length; index += rowsPerStatement) {
			const rows = document.tables[table].slice(index, index + rowsPerStatement);
			const rowPlaceholders = `(${columns.map(() => "?").join(", ")})`;
			const sql = `INSERT INTO ${quoteIdentifier(stagingTables[table])} (${columns.map(quoteIdentifier).join(", ")}) VALUES ${rows.map(() => rowPlaceholders).join(", ")}`;
			const values = rows.flatMap((row) => columns.map((column) => row[column]));
			statements.push(db.prepare(sql).bind(...values));
		}
	}

	if (statements.length > MAX_STAGING_INSERT_STATEMENTS) {
		throw new Error("Backup contains too many records to restore safely in one request");
	}
	for (let index = 0; index < statements.length; index += STAGING_BATCH_SIZE) {
		await db.batch(statements.slice(index, index + STAGING_BATCH_SIZE));
	}
}

function createFinalRestoreStatements(
	document: NormalizedDatabaseBackupDocument,
	stagingTables: Record<DatabaseBackupTable, string>,
	selectedColumns: Record<DatabaseBackupTable, string[]>,
	recovery: RecoveryBackup,
): RestoreSqlStatement[] {
	const statements: RestoreSqlStatement[] = [...BACKUP_TABLES]
		.reverse()
		.map((table) => ({ sql: `DELETE FROM ${quoteIdentifier(table)}` }));

	for (const table of BACKUP_TABLES) {
		// Restoring authentication sessions would revive old credentials. The
		// sessions table is emptied above and deliberately not copied back.
		if (table === "sessions" || document.tables[table].length === 0) continue;
		const columns = selectedColumns[table];
		const identifiers = columns.map(quoteIdentifier).join(", ");
		statements.push({
			sql: `INSERT INTO ${quoteIdentifier(table)} (${identifiers}) SELECT ${identifiers} FROM ${quoteIdentifier(stagingTables[table])}`,
		});
	}
	statements.push({ sql: recoveryBackupInsertSql(), values: recoveryBackupValues(recovery) });
	return statements;
}

export async function executeAtomicRestoreBatch(
	db: Pick<D1Database, "prepare" | "batch">,
	statements: readonly RestoreSqlStatement[],
): Promise<void> {
	const prepared = statements.map((statement) => {
		const query = db.prepare(statement.sql);
		return statement.values ? query.bind(...statement.values) : query;
	});
	await db.batch(prepared);
}

async function dropStagingTables(
	db: D1Database,
	stagingTables: Record<DatabaseBackupTable, string>,
): Promise<void> {
	await db.batch(
		[...BACKUP_TABLES]
			.reverse()
			.map((table) => db.prepare(`DROP TABLE IF EXISTS ${quoteIdentifier(stagingTables[table])}`)),
	);
}

function recoveryBackupInsertSql(): string {
	return `INSERT INTO backups (id, status, trigger, r2_key, filename, size, error, created_by_user_id, created_at, started_at, completed_at)
		VALUES (?, 'completed', 'manual', ?, ?, ?, NULL, NULL, unixepoch(), unixepoch(), unixepoch())`;
}

function recoveryBackupValues(recovery: RecoveryBackup): readonly (string | number)[] {
	return [recovery.id, recovery.r2Key, recovery.filename, recovery.size];
}

function quoteIdentifier(value: string): string {
	return `\"${value.replaceAll("\"", "\"\"")}\"`;
}

function quoteString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

export function restoreTooLargeError(): Error {
	return new Error(`Backup file exceeds the ${MAX_DATABASE_RESTORE_BYTES / (1024 * 1024)} MiB restore limit`);
}
