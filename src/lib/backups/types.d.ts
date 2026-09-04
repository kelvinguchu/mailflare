import type {
	BACKUP_TABLES,
	DATABASE_BACKUP_R2_STRATEGY,
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
export type DatabaseBackupObjectChecksums = {
	md5?: string;
	sha1?: string;
	sha256?: string;
	sha384?: string;
	sha512?: string;
};
export type DatabaseBackupObjectHttpMetadata = {
	contentType?: string;
	contentLanguage?: string;
	contentDisposition?: string;
	contentEncoding?: string;
	cacheControl?: string;
	cacheExpiry?: string;
};
export type DatabaseBackupObject = {
	sourceKey: string;
	snapshotKey: string;
	size: number;
	etag: string;
	checksums: DatabaseBackupObjectChecksums;
	httpMetadata: DatabaseBackupObjectHttpMetadata;
	customMetadata: Record<string, string>;
	storageClass: "Standard" | "InfrequentAccess";
};
export type DatabaseBackupR2Snapshot = {
	strategy: typeof DATABASE_BACKUP_R2_STRATEGY;
	objects: DatabaseBackupObject[];
};
export type DatabaseBackupDocument = {
	format: typeof DATABASE_BACKUP_FORMAT;
	version: typeof DATABASE_BACKUP_VERSION;
	createdAt: string;
	tables: Record<DatabaseBackupTable, DatabaseRecord[]>;
	r2: DatabaseBackupR2Snapshot;
};
export type NormalizedDatabaseBackupDocument = Omit<DatabaseBackupDocument, "r2"> & {
	sourceVersion: 1 | 2 | typeof DATABASE_BACKUP_VERSION;
	r2: DatabaseBackupR2Snapshot | { strategy: "live-references"; objects: [] };
};
