import type {
	BACKUP_TABLES,
	DATABASE_BACKUP_FORMAT,
	DATABASE_BACKUP_VERSION,
} from "./format";

export type BackupScheduleType = "daily" | "weekly" | "monthly";

export type BackupWorkflowParams = {
	backupId?: string;
	force?: boolean;
};

export type BackupWorkflowBinding = {
	create(options?: {
		id?: string;
		params?: BackupWorkflowParams;
	}): Promise<unknown>;
};

export type DatabaseBackupTable = (typeof BACKUP_TABLES)[number];
export type DatabaseRecord = Record<string, string | number | null>;
export type DatabaseBackupDocument = {
	format: typeof DATABASE_BACKUP_FORMAT;
	version: typeof DATABASE_BACKUP_VERSION;
	createdAt: string;
	tables: Record<DatabaseBackupTable, DatabaseRecord[]>;
};
