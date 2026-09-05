import { describe, expect, it } from "vitest";
import { BACKUP_TABLES, DATABASE_BACKUP_FORMAT, DATABASE_BACKUP_VERSION } from "../src/lib/backups/format";
import { normalizeDatabaseBackupDocument } from "../src/lib/backups/export";
import {
	getReferencedR2Keys,
	restoreDatabaseBackupObjects,
	snapshotDatabaseObjects,
	validateDatabaseBackupObjects,
} from "../src/lib/backups/objects";
import type { DatabaseBackupTable, DatabaseRecord } from "../src/lib/backups/types";

type StoredObject = {
	bytes: Uint8Array;
	etag: string;
	httpMetadata: R2HTTPMetadata;
	customMetadata: Record<string, string>;
	storageClass: "Standard" | "InfrequentAccess";
};

function emptyTables(): Record<DatabaseBackupTable, DatabaseRecord[]> {
	return Object.fromEntries(BACKUP_TABLES.map((table) => [table, []])) as Record<
		DatabaseBackupTable,
		DatabaseRecord[]
	>;
}

function createFakeBucket() {
	const objects = new Map<string, StoredObject>();
	const encoder = new TextEncoder();
	const decoder = new TextDecoder();

	function metadata(key: string, stored: StoredObject): R2Object {
		return {
			key,
			version: "test-version",
			size: stored.bytes.byteLength,
			etag: stored.etag,
			httpEtag: `"${stored.etag}"`,
			uploaded: new Date("2026-09-04T00:00:00.000Z"),
			httpMetadata: stored.httpMetadata,
			customMetadata: stored.customMetadata,
			range: undefined,
			storageClass: stored.storageClass,
			checksums: {
				toJSON: () => ({}),
			},
		} as R2Object;
	}

	async function bytesFromValue(value: R2PutValue): Promise<Uint8Array> {
		if (value === null) return new Uint8Array();
		if (typeof value === "string") return encoder.encode(value);
		if (value instanceof ArrayBuffer) return new Uint8Array(value);
		if (ArrayBuffer.isView(value)) {
			return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
		}
		return new Uint8Array(await new Response(value).arrayBuffer());
	}

	const bucket = {
		async put(key: string, value: R2PutValue, options?: R2PutOptions) {
			const bytes = await bytesFromValue(value);
			const stored: StoredObject = {
				bytes: new Uint8Array(bytes),
				etag: `etag-${bytes.byteLength}-${bytes[0] ?? 0}`,
				httpMetadata: options?.httpMetadata ?? {},
				customMetadata: options?.customMetadata ?? {},
				storageClass: options?.storageClass === "InfrequentAccess" ? "InfrequentAccess" : "Standard",
			};
			objects.set(key, stored);
			return metadata(key, stored);
		},
		async head(key: string) {
			const stored = objects.get(key);
			return stored ? metadata(key, stored) : null;
		},
		async get(key: string) {
			const stored = objects.get(key);
			if (!stored) return null;
			const base = metadata(key, stored);
			return {
				...base,
				body: new Blob([stored.bytes]).stream(),
				bodyUsed: false,
				arrayBuffer: async () => stored.bytes.slice().buffer,
				text: async () => decoder.decode(stored.bytes),
				json: async () => JSON.parse(decoder.decode(stored.bytes)) as unknown,
				blob: async () => new Blob([stored.bytes]),
				writeHttpMetadata: () => undefined,
			} as R2ObjectBody;
		},
	} as unknown as R2Bucket;

	return { bucket, objects };
}

describe("database backup R2 snapshots", () => {
	it("discovers every live object category and excludes backup-history files", () => {
		const tables = emptyTables();
		tables.users = [{ avatar_key: "users/avatar.png" }];
		tables.mailboxes = [{ avatar_key: "mailboxes/avatar.png" }];
		tables.messages = [{ raw_r2_key: "raw/message.eml" }];
		tables.message_attachments = [{ r2_key: "attachments/report.pdf" }];
		tables.app_settings = [{ icon_key: "branding/icon.png" }];
		tables.dead_letter_events = [{
			source_queue: "inbound",
			payload: JSON.stringify({ rawR2Key: "inbound/dead-letter.eml" }),
		}];
		tables.backups = [{ r2_key: "database-backups/older/manifest.json" }];

		expect(getReferencedR2Keys({ tables })).toEqual([
			"attachments/report.pdf",
			"branding/icon.png",
			"inbound/dead-letter.eml",
			"mailboxes/avatar.png",
			"raw/message.eml",
			"users/avatar.png",
		]);
	});

	it("copies referenced objects independently and restores their original bytes", async () => {
		const { bucket } = createFakeBucket();
		const tables = emptyTables();
		tables.users = [{ avatar_key: "users/avatar.png" }];
		tables.messages = [{ raw_r2_key: "raw/message.eml" }];
		await bucket.put("users/avatar.png", "original-avatar", { httpMetadata: { contentType: "image/png" } });
		await bucket.put("raw/message.eml", "original-message", { httpMetadata: { contentType: "message/rfc822" } });

		const r2 = await snapshotDatabaseObjects(bucket, "bak_test", { tables });
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: DATABASE_BACKUP_VERSION,
			createdAt: "2026-09-04T00:00:00.000Z",
			tables,
			r2,
		});
		await validateDatabaseBackupObjects(bucket, document);

		await bucket.put("users/avatar.png", "changed-avatar");
		await bucket.put("raw/message.eml", "changed-message");
		await restoreDatabaseBackupObjects(bucket, document);

		expect(await (await bucket.get("users/avatar.png"))?.text()).toBe("original-avatar");
		expect(await (await bucket.get("raw/message.eml"))?.text()).toBe("original-message");
	});

	it("detects a changed snapshot before live keys are mutated", async () => {
		const { bucket, objects } = createFakeBucket();
		const tables = emptyTables();
		tables.message_attachments = [{ r2_key: "attachments/report.pdf" }];
		await bucket.put("attachments/report.pdf", "original-report");
		const r2 = await snapshotDatabaseObjects(bucket, "bak_tampered", { tables });
		const document = normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: DATABASE_BACKUP_VERSION,
			createdAt: "2026-09-04T00:00:00.000Z",
			tables,
			r2,
		});
		const snapshotKey = r2.objects[0]?.snapshotKey;
		if (!snapshotKey) throw new Error("Expected an R2 snapshot");
		const stored = objects.get(snapshotKey);
		if (!stored) throw new Error("Expected the fake bucket to contain the snapshot");
		stored.bytes = new TextEncoder().encode("tampered");

		await expect(validateDatabaseBackupObjects(bucket, document)).rejects.toThrow(
			"snapshot metadata mismatch",
		);
	});

	it("rejects a current-format manifest that omits a referenced object", () => {
		const tables = emptyTables();
		tables.users = [{ avatar_key: "users/avatar.png" }];

		expect(() => normalizeDatabaseBackupDocument({
			format: DATABASE_BACKUP_FORMAT,
			version: DATABASE_BACKUP_VERSION,
			createdAt: "2026-09-04T00:00:00.000Z",
			tables,
			r2: { strategy: "independent-copies-v1", objects: [] },
		})).toThrow("invalid R2 backup manifest");
	});
});
