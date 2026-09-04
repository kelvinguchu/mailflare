import type { StoredAttachment } from "./attachment-types";

export type InboundMessageWrite = {
	id: string;
	deliveryKey: string;
	userId: string;
	mailboxId: string;
	folderId: string | null;
	providerMessageId: string | null;
	fromAddr: string;
	toAddr: string;
	subject: string | null;
	snippet: string;
	textBody: string | null;
	htmlBody: string | null;
	rawR2Key: string;
	status: "received" | "spam" | "trash";
	threadId: string | null;
	createdAt: Date;
};

export type InboundCommitResult = {
	created: boolean;
	messageId: string;
};

type InboundDatabase = Pick<D1Database, "prepare" | "batch">;

export async function createInboundDeliveryKey(
	from: string,
	to: string,
	raw: ArrayBuffer,
): Promise<string> {
	const rawDigest = await sha256(raw);
	const material = new TextEncoder().encode([
		from.trim().toLowerCase(),
		to.trim().toLowerCase(),
		toHex(rawDigest),
	].join("\u0000"));
	return toHex(await sha256(material));
}

export function isInboundDeliveryKey(value: unknown): value is string {
	return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function createInboundMessageId(deliveryKey: string): string {
	return `msg_in_${deliveryKey}`;
}

export async function findInboundMessageId(
	db: Pick<D1Database, "prepare">,
	deliveryKey: string,
): Promise<string | null> {
	const row = await db
		.prepare("SELECT id FROM messages WHERE inbound_delivery_key = ? LIMIT 1")
		.bind(deliveryKey)
		.first<{ id: string }>();
	return row?.id ?? null;
}

export async function commitInboundMessage(
	db: InboundDatabase,
	message: InboundMessageWrite,
	attachments: StoredAttachment[],
): Promise<InboundCommitResult> {
	const existingMessageId = await findInboundMessageId(db, message.deliveryKey);
	if (existingMessageId) return { created: false, messageId: existingMessageId };

	const createdAt = Math.floor(message.createdAt.getTime() / 1_000);
	const statements = [
		db.prepare(`INSERT INTO messages (
			id, user_id, mailbox_id, direction, provider_message_id, folder_id,
			from_addr, to_addr, subject, snippet, text_body, html_body, raw_r2_key,
			status, thread_id, inbound_delivery_key, created_at
		) VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
			.bind(
				message.id,
				message.userId,
				message.mailboxId,
				message.providerMessageId,
				message.folderId,
				message.fromAddr,
				message.toAddr,
				message.subject,
				message.snippet,
				message.textBody,
				message.htmlBody,
				message.rawR2Key,
				message.status,
				message.threadId,
				message.deliveryKey,
				createdAt,
			),
		...attachments.map((attachment) =>
			db.prepare(`INSERT INTO message_attachments (
				id, message_id, filename, content_type, size, disposition, content_id, r2_key, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
				.bind(
					attachment.id,
					attachment.messageId,
					attachment.filename,
					attachment.type,
					attachment.size,
					attachment.disposition,
					attachment.contentId,
					attachment.r2Key,
					createdAt,
				),
		),
	];

	try {
		await db.batch(statements);
		return { created: true, messageId: message.id };
	} catch (error) {
		const racedMessageId = await findInboundMessageId(db, message.deliveryKey);
		if (racedMessageId) return { created: false, messageId: racedMessageId };
		throw error;
	}
}

async function sha256(value: BufferSource): Promise<ArrayBuffer> {
	return crypto.subtle.digest("SHA-256", value);
}

function toHex(value: ArrayBuffer): string {
	return [...new Uint8Array(value)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
