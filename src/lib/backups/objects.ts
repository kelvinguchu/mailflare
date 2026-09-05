import {
	BACKUP_PREFIX,
} from "./utils";
import {
	DATABASE_BACKUP_R2_STRATEGY,
	MAX_BACKUP_OBJECTS,
} from "./format";
import type {
	DatabaseBackupDocument,
	DatabaseBackupObject,
	DatabaseBackupObjectChecksums,
	DatabaseBackupObjectHttpMetadata,
	DatabaseBackupR2Snapshot,
	DatabaseBackupTable,
	NormalizedDatabaseBackupDocument,
} from "./types";

const R2_REFERENCE_COLUMNS = {
	users: ["avatar_key"],
	mailboxes: ["avatar_key"],
	messages: ["raw_r2_key"],
	message_attachments: ["r2_key"],
	app_settings: ["icon_key"],
} satisfies Partial<Record<DatabaseBackupTable, readonly string[]>>;

export function getReferencedR2Keys(
	document: Pick<DatabaseBackupDocument, "tables">,
): string[] {
	const keys = new Set<string>();
	for (const [table, columns] of Object.entries(R2_REFERENCE_COLUMNS) as Array<[
		DatabaseBackupTable,
		readonly string[],
	]>) {
		for (const row of document.tables[table]) {
			for (const column of columns) {
				const value = row[column];
				if (typeof value === "string" && value.length > 0) keys.add(value);
			}
		}
	}
	for (const row of document.tables.dead_letter_events) {
		if (row.source_queue !== "inbound" || typeof row.payload !== "string") continue;
		try {
			const payload = JSON.parse(row.payload) as unknown;
			if (
				typeof payload === "object" &&
				payload !== null &&
				"rawR2Key" in payload &&
				typeof payload.rawR2Key === "string" &&
				payload.rawR2Key.length > 0
			) {
				keys.add(payload.rawR2Key);
			}
		} catch {
			// Malformed diagnostic payloads cannot be replayed and contain no trusted R2 reference.
		}
	}
	return [...keys].sort();
}

export async function snapshotDatabaseObjects(
	bucket: R2Bucket,
	backupId: string,
	document: Pick<DatabaseBackupDocument, "tables">,
): Promise<DatabaseBackupR2Snapshot> {
	const sourceKeys = getReferencedR2Keys(document);
	if (sourceKeys.length > MAX_BACKUP_OBJECTS) {
		throw new Error(`Database references too many R2 objects (maximum ${MAX_BACKUP_OBJECTS})`);
	}

	const objects: DatabaseBackupObject[] = [];
	for (const sourceKey of sourceKeys) {
		const source = await bucket.get(sourceKey);
		if (!source) throw new Error(`Database references missing R2 object: ${sourceKey}`);
		const snapshotKey = await createSnapshotKey(backupId, sourceKey);
		const sourceStorageClass = normalizeStorageClass(source.storageClass);
		const stored = await bucket.put(snapshotKey, source.body, {
			httpMetadata: source.httpMetadata,
			customMetadata: source.customMetadata,
			storageClass: sourceStorageClass,
			...(source.checksums.md5 ? { md5: source.checksums.md5 } : {}),
		});
		if (!stored) throw new Error(`Failed to snapshot R2 object: ${sourceKey}`);
		if (stored.size !== source.size) {
			throw new Error(`R2 snapshot size mismatch for: ${sourceKey}`);
		}
		const sourceChecksums = source.checksums.toJSON();
		const storedChecksums = stored.checksums.toJSON();
		if (sourceChecksums.md5 && storedChecksums.md5 !== sourceChecksums.md5) {
			throw new Error(`R2 snapshot checksum mismatch for: ${sourceKey}`);
		}
		objects.push({
			sourceKey,
			snapshotKey,
			size: stored.size,
			etag: stored.etag,
			checksums: storedChecksums,
			httpMetadata: serializeHttpMetadata(source.httpMetadata ?? {}),
			customMetadata: source.customMetadata ?? {},
			storageClass: sourceStorageClass,
		});
	}
	return { strategy: DATABASE_BACKUP_R2_STRATEGY, objects };
}

export function normalizeDatabaseBackupR2(value: unknown): DatabaseBackupR2Snapshot {
	if (!isRecord(value) || value.strategy !== DATABASE_BACKUP_R2_STRATEGY || !Array.isArray(value.objects)) {
		throw invalidR2ManifestError();
	}
	if (value.objects.length > MAX_BACKUP_OBJECTS) throw invalidR2ManifestError();
	return {
		strategy: DATABASE_BACKUP_R2_STRATEGY,
		objects: value.objects.map(normalizeBackupObject),
	};
}

export function validateDatabaseBackupObjectCoverage(document: NormalizedDatabaseBackupDocument): void {
	if (document.r2.strategy === "live-references") return;
	const referenced = getReferencedR2Keys(document);
	const manifestKeys = document.r2.objects.map((object) => object.sourceKey);
	const sortedManifestKeys = [...manifestKeys].sort();
	if (new Set(manifestKeys).size !== manifestKeys.length) throw invalidR2ManifestError();
	if (referenced.length !== manifestKeys.length) throw invalidR2ManifestError();
	for (let index = 0; index < referenced.length; index += 1) {
		if (referenced[index] !== sortedManifestKeys[index]) throw invalidR2ManifestError();
	}
}

export async function validateDatabaseBackupObjects(
	bucket: R2Bucket,
	document: NormalizedDatabaseBackupDocument,
): Promise<void> {
	if (document.r2.strategy === "live-references") {
		for (const sourceKey of getReferencedR2Keys(document)) {
			if (!(await bucket.head(sourceKey))) {
				throw new Error(`Legacy backup references missing R2 object: ${sourceKey}`);
			}
		}
		return;
	}
	for (const object of document.r2.objects) {
		const stored = await bucket.head(object.snapshotKey);
		if (!stored) throw new Error(`Backup snapshot is missing R2 object: ${object.sourceKey}`);
		assertSnapshotMatchesManifest(object, stored);
	}
}

export async function restoreDatabaseBackupObjects(
	bucket: R2Bucket,
	document: NormalizedDatabaseBackupDocument,
	onMutationStarted?: (sourceKey: string) => void,
): Promise<string[]> {
	if (document.r2.strategy === "live-references") return [];
	const restored: string[] = [];
	for (const object of document.r2.objects) {
		onMutationStarted?.(object.sourceKey);
		await copySnapshotToSource(bucket, object);
		restored.push(object.sourceKey);
	}
	return restored;
}

export async function rollbackDatabaseBackupObjects(
	bucket: R2Bucket,
	restoredKeys: readonly string[],
	recoveryDocument: DatabaseBackupDocument,
): Promise<void> {
	const recoveryBySource = new Map(
		recoveryDocument.r2.objects.map((object) => [object.sourceKey, object]),
	);
	for (const sourceKey of [...restoredKeys].reverse()) {
		const recoveryObject = recoveryBySource.get(sourceKey);
		if (recoveryObject) await copySnapshotToSource(bucket, recoveryObject);
		else await bucket.delete(sourceKey);
	}
}

export async function deleteBackupBundle(bucket: R2Bucket, backupId: string): Promise<void> {
	const prefix = `${BACKUP_PREFIX}/${backupId}/`;
	while (true) {
		const listed = await bucket.list({ prefix, limit: 1_000 });
		const keys = listed.objects.map((object) => object.key);
		if (keys.length === 0) return;
		await bucket.delete(keys);
	}
}

async function copySnapshotToSource(bucket: R2Bucket, object: DatabaseBackupObject): Promise<void> {
	const snapshot = await bucket.get(object.snapshotKey);
	if (!snapshot) throw new Error(`Backup snapshot is missing R2 object: ${object.sourceKey}`);
	assertSnapshotMatchesManifest(object, snapshot);
	const stored = await bucket.put(object.sourceKey, snapshot.body, {
		httpMetadata: deserializeHttpMetadata(object.httpMetadata),
		customMetadata: object.customMetadata,
		storageClass: object.storageClass,
		...(snapshot.checksums.md5 ? { md5: snapshot.checksums.md5 } : {}),
	});
	if (!stored || stored.size !== object.size) {
		throw new Error(`Restored R2 object size mismatch for: ${object.sourceKey}`);
	}
	const expectedMd5 = object.checksums.md5;
	if (expectedMd5 && stored.checksums.toJSON().md5 !== expectedMd5) {
		throw new Error(`Restored R2 object checksum mismatch for: ${object.sourceKey}`);
	}
}

function assertSnapshotMatchesManifest(object: DatabaseBackupObject, stored: R2Object): void {
	if (stored.size !== object.size || stored.etag !== object.etag) {
		throw new Error(`Backup R2 snapshot metadata mismatch for: ${object.sourceKey}`);
	}
	const actualChecksums = stored.checksums.toJSON();
	for (const [algorithm, expected] of Object.entries(object.checksums)) {
		if (actualChecksums[algorithm as keyof DatabaseBackupObjectChecksums] !== expected) {
			throw new Error(`Backup R2 snapshot checksum mismatch for: ${object.sourceKey}`);
		}
	}
}

async function createSnapshotKey(backupId: string, sourceKey: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sourceKey));
	const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${BACKUP_PREFIX}/${backupId}/objects/${hash}`;
}

function normalizeBackupObject(value: unknown): DatabaseBackupObject {
	if (!isRecord(value)) throw invalidR2ManifestError();
	if (
		typeof value.sourceKey !== "string" || value.sourceKey.length === 0 ||
		typeof value.snapshotKey !== "string" || !value.snapshotKey.startsWith(`${BACKUP_PREFIX}/`) ||
		typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0 ||
		typeof value.etag !== "string" || value.etag.length === 0 ||
		(value.storageClass !== "Standard" && value.storageClass !== "InfrequentAccess") ||
		!isRecord(value.checksums) || !isRecord(value.httpMetadata) || !isRecord(value.customMetadata)
	) {
		throw invalidR2ManifestError();
	}
	return {
		sourceKey: value.sourceKey,
		snapshotKey: value.snapshotKey,
		size: value.size,
		etag: value.etag,
		checksums: normalizeStringRecord(value.checksums, ["md5", "sha1", "sha256", "sha384", "sha512"]),
		httpMetadata: normalizeStringRecord(value.httpMetadata, [
			"contentType",
			"contentLanguage",
			"contentDisposition",
			"contentEncoding",
			"cacheControl",
			"cacheExpiry",
		]),
		customMetadata: normalizeStringRecord(value.customMetadata),
		storageClass: value.storageClass,
	};
}

function normalizeStringRecord<T extends Record<string, string | undefined>>(
	value: Record<string, unknown>,
	allowedKeys?: readonly string[],
): T {
	const normalized: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if ((allowedKeys && !allowedKeys.includes(key)) || typeof item !== "string") {
			throw invalidR2ManifestError();
		}
		normalized[key] = item;
	}
	return normalized as T;
}

function serializeHttpMetadata(metadata: R2HTTPMetadata): DatabaseBackupObjectHttpMetadata {
	return {
		...(metadata.contentType ? { contentType: metadata.contentType } : {}),
		...(metadata.contentLanguage ? { contentLanguage: metadata.contentLanguage } : {}),
		...(metadata.contentDisposition ? { contentDisposition: metadata.contentDisposition } : {}),
		...(metadata.contentEncoding ? { contentEncoding: metadata.contentEncoding } : {}),
		...(metadata.cacheControl ? { cacheControl: metadata.cacheControl } : {}),
		...(metadata.cacheExpiry ? { cacheExpiry: metadata.cacheExpiry.toISOString() } : {}),
	};
}

function deserializeHttpMetadata(metadata: DatabaseBackupObjectHttpMetadata): R2HTTPMetadata {
	return {
		...(metadata.contentType ? { contentType: metadata.contentType } : {}),
		...(metadata.contentLanguage ? { contentLanguage: metadata.contentLanguage } : {}),
		...(metadata.contentDisposition ? { contentDisposition: metadata.contentDisposition } : {}),
		...(metadata.contentEncoding ? { contentEncoding: metadata.contentEncoding } : {}),
		...(metadata.cacheControl ? { cacheControl: metadata.cacheControl } : {}),
		...(metadata.cacheExpiry ? { cacheExpiry: new Date(metadata.cacheExpiry) } : {}),
	};
}

function normalizeStorageClass(value: string): DatabaseBackupObject["storageClass"] {
	return value === "InfrequentAccess" ? value : "Standard";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function invalidR2ManifestError(): Error {
	return new Error("The selected file contains an invalid R2 backup manifest");
}
