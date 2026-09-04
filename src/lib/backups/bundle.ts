import {
	DATABASE_BACKUP_FORMAT,
	DATABASE_BACKUP_VERSION,
	MAX_DATABASE_RESTORE_BYTES,
} from "./format";
import {
	exportDatabaseDocument,
	serializeDatabaseBackup,
} from "./export";
import { snapshotDatabaseObjects } from "./objects";
import type { DatabaseBackupDocument } from "./types";
import {
	BACKUP_PREFIX,
	createBackupFilename,
} from "./utils";

export type StoredBackupBundle = {
	document: DatabaseBackupDocument;
	filename: string;
	r2Key: string;
	manifestSize: number;
	objectCount: number;
	objectSize: number;
	totalSize: number;
};

export async function createBackupBundle(
	env: Pick<CloudflareEnv, "DB" | "BUCKET">,
	backupId: string,
	options?: { now?: Date; purpose?: "database-backup" | "pre-restore-recovery" },
): Promise<StoredBackupBundle> {
	const now = options?.now ?? new Date();
	const document = await exportDatabaseDocument(env.DB);
	document.createdAt = now.toISOString();
	document.r2 = await snapshotDatabaseObjects(env.BUCKET, backupId, document);
	const content = serializeDatabaseBackup(document);
	if (content.byteLength > MAX_DATABASE_RESTORE_BYTES) {
		throw new Error("Backup manifest exceeds the 10 MiB restore limit");
	}

	const filename = options?.purpose === "pre-restore-recovery"
		? `cc-mail-v${DATABASE_BACKUP_VERSION}-pre-restore-${now.toISOString().replace(/[:.]/g, "-")}.json`
		: createBackupFilename(now);
	const r2Key = `${BACKUP_PREFIX}/${backupId}/${filename}`;
	const objectSize = document.r2.objects.reduce((total, object) => total + object.size, 0);
	const stored = await env.BUCKET.put(r2Key, content, {
		httpMetadata: { contentType: "application/json" },
		customMetadata: {
			backupId,
			backupFormat: DATABASE_BACKUP_FORMAT,
			backupVersion: String(DATABASE_BACKUP_VERSION),
			backupPurpose: options?.purpose ?? "database-backup",
			objectCount: String(document.r2.objects.length),
			objectSize: String(objectSize),
		},
	});
	if (!stored) throw new Error("Failed to store database backup manifest");
	return {
		document,
		filename,
		r2Key,
		manifestSize: stored.size,
		objectCount: document.r2.objects.length,
		objectSize,
		totalSize: stored.size + objectSize,
	};
}
