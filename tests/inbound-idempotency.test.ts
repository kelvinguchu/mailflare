import { describe, expect, it, vi } from "vitest";
import {
	commitInboundMessage,
	createInboundDeliveryKey,
	createInboundMessageId,
	type InboundMessageWrite,
} from "../src/lib/email/inbound-idempotency";
import { stageInboundMessageAttachments } from "../src/lib/email/inbound-attachments";
import type { StoredAttachment } from "../src/lib/email/attachment-types";

type PreparedRecord = {
	sql: string;
	values: unknown[];
	statement?: D1PreparedStatement;
};

function createFakeDatabase(options?: { raceOnFirstBatch?: boolean }) {
	let existingMessageId: string | null = null;
	const prepared: PreparedRecord[] = [];
	const prepare = vi.fn((sql: string) => {
		const record: PreparedRecord = { sql, values: [] };
		const statement = {
			bind: (...values: unknown[]) => {
				record.values = values;
				return statement;
			},
			first: async <T>() => existingMessageId ? { id: existingMessageId } as T : null,
		} as D1PreparedStatement;
		record.statement = statement;
		prepared.push(record);
		return statement;
	});
	const batch = vi.fn(async (statements: D1PreparedStatement[]) => {
		const messageInsert = prepared.find((record) =>
			record.sql.startsWith("INSERT INTO messages") && statements.includes(record.statement),
		);
		existingMessageId = String(messageInsert?.values[0] ?? "");
		if (options?.raceOnFirstBatch) throw new Error("UNIQUE constraint failed");
		return [];
	});
	return {
		db: { prepare, batch } as Pick<D1Database, "prepare" | "batch">,
		batch,
		prepared,
	};
}

function message(deliveryKey: string): InboundMessageWrite {
	return {
		id: createInboundMessageId(deliveryKey),
		deliveryKey,
		userId: "user_1",
		mailboxId: "mailbox_1",
		folderId: null,
		providerMessageId: null,
		fromAddr: "sender@example.com",
		toAddr: "info@calibercode.io",
		subject: "Hello",
		snippet: "Hello",
		textBody: "Hello",
		htmlBody: null,
		rawR2Key: `inbound/${deliveryKey}.eml`,
		status: "received",
		threadId: null,
		createdAt: new Date("2026-09-04T00:00:00.000Z"),
	};
}

function attachment(messageId: string, deliveryKey: string, index: number): StoredAttachment {
	return {
		id: `att_in_${deliveryKey}_${index}`,
		messageId,
		filename: `file-${index}.txt`,
		type: "text/plain",
		size: 4,
		disposition: "attachment",
		contentId: null,
		r2Key: `attachments/inbound/${deliveryKey}/${index}-file.txt`,
	};
}

describe("inbound delivery idempotency", () => {
	it("derives a stable identity without relying on a valid Message-ID", async () => {
		const malformed = new TextEncoder().encode(
			"From: sender@example.com\r\nTo: info@calibercode.io\r\nMessage-ID: not-valid\r\n\r\nHello",
		).buffer;
		const missing = new TextEncoder().encode(
			"From: sender@example.com\r\nTo: info@calibercode.io\r\n\r\nHello",
		).buffer;

		const first = await createInboundDeliveryKey("sender@example.com", "info@calibercode.io", malformed);
		const retry = await createInboundDeliveryKey("SENDER@example.com", "INFO@calibercode.io", malformed);
		const withoutHeader = await createInboundDeliveryKey("sender@example.com", "info@calibercode.io", missing);

		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(retry).toBe(first);
		expect(withoutHeader).toMatch(/^[a-f0-9]{64}$/);
	});

	it("keeps identical raw mail to different envelope recipients distinct", async () => {
		const raw = new TextEncoder().encode("From: sender@example.com\r\n\r\nHello").buffer;
		const first = await createInboundDeliveryKey("sender@example.com", "info@calibercode.io", raw);
		const second = await createInboundDeliveryKey("sender@example.com", "support@calibercode.io", raw);
		expect(second).not.toBe(first);
	});

	it("commits one message and one attachment set across a repeated delivery", async () => {
		const deliveryKey = "a".repeat(64);
		const input = message(deliveryKey);
		const attachments = [attachment(input.id, deliveryKey, 0), attachment(input.id, deliveryKey, 1)];
		const { db, batch } = createFakeDatabase();

		const first = await commitInboundMessage(db, input, attachments);
		const retry = await commitInboundMessage(db, input, attachments);

		expect(first).toEqual({ created: true, messageId: input.id });
		expect(retry).toEqual({ created: false, messageId: input.id });
		expect(batch).toHaveBeenCalledTimes(1);
		expect(batch.mock.calls[0]?.[0]).toHaveLength(3);
	});

	it("treats a concurrent unique-key winner as the same completed delivery", async () => {
		const deliveryKey = "b".repeat(64);
		const input = message(deliveryKey);
		const { db, batch } = createFakeDatabase({ raceOnFirstBatch: true });

		await expect(commitInboundMessage(db, input, [])).resolves.toEqual({
			created: false,
			messageId: input.id,
		});
		expect(batch).toHaveBeenCalledTimes(1);
	});

	it("reuses deterministic attachment objects on retry", async () => {
		const objects = new Map<string, { size: number; customMetadata: Record<string, string> }>();
		const bucket = {
			head: vi.fn(async (key: string) => {
				const object = objects.get(key);
				return object ? { key, ...object } as R2Object : null;
			}),
			put: vi.fn(async (key: string, value: ArrayBuffer, options: R2PutOptions) => {
				const object = {
					size: value.byteLength,
					customMetadata: options.customMetadata ?? {},
				};
				objects.set(key, object);
				return { key, ...object } as R2Object;
			}),
		} as Pick<R2Bucket, "head" | "put">;
		const env = { BUCKET: bucket as R2Bucket };
		const deliveryKey = "c".repeat(64);
		const source = [{
			filename: "report.txt",
			type: "text/plain",
			content: new TextEncoder().encode("report").buffer,
		}];

		const first = await stageInboundMessageAttachments(env, createInboundMessageId(deliveryKey), deliveryKey, source);
		const retry = await stageInboundMessageAttachments(env, createInboundMessageId(deliveryKey), deliveryKey, source);

		expect(retry).toEqual(first);
		expect(bucket.put).toHaveBeenCalledTimes(1);
	});
});
