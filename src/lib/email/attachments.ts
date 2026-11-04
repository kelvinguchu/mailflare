import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messageAttachments, messages } from "@/db/schema";
import { newId } from "@/lib/ids";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import type { SessionUser } from "@/lib/auth/types";
import type { AttachmentContent, AttachmentMetadata, StoredAttachment } from "./attachment-types";

import { attachmentLimitError, MAX_ATTACHMENT_COUNT, SendLimitError } from "./limits";
export { MAX_ATTACHMENT_SIZE, MAX_TOTAL_ATTACHMENT_SIZE, MAX_ATTACHMENT_COUNT } from "./limits";

export function decodeBase64Content(content: string): ArrayBuffer {
	const binary = atob(content.replace(/\s/g, ""));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

export function normalizeAttachmentContent(
	content: ArrayBuffer | Uint8Array | string,
	encoding?: "base64" | "utf8",
): ArrayBuffer {
	if (content instanceof ArrayBuffer) return content;
	if (content instanceof Uint8Array) {
		return content.buffer.slice(
			content.byteOffset,
			content.byteOffset + content.byteLength,
		) as ArrayBuffer;
	}
	if (encoding === "base64") return decodeBase64Content(content);
	return new TextEncoder().encode(content).buffer;
}

function sanitizeFilename(filename: string): string {
	const normalized = filename.trim().replace(/[/\\\x00-\x1f\x7f]/g, "_");
	return normalized || "attachment";
}

export function validateAttachments(attachments: AttachmentContent[]): void {
	const error = attachmentLimitError(
		attachments.map((file) => ({ size: file.content.byteLength })),
	);
	if (error)
		throw new SendLimitError(
			error,
			attachments.length > MAX_ATTACHMENT_COUNT ? "E_TOO_MANY_ATTACHMENTS" : "E_CONTENT_TOO_LARGE",
			attachments.length > MAX_ATTACHMENT_COUNT ? 400 : 413,
		);
}

export async function storeMessageAttachments(
	env: CloudflareEnv,
	messageId: string,
	attachments: AttachmentContent[],
	options?: { validate?: boolean },
): Promise<StoredAttachment[]> {
	if (options?.validate !== false) validateAttachments(attachments);
	const db = getDb(env);
	const stored: StoredAttachment[] = [];

	try {
		for (const attachment of attachments) {
			const id = newId("att");
			const filename = sanitizeFilename(attachment.filename);
			const r2Key = `attachments/${messageId}/${id}/${filename}`;
			const disposition = attachment.disposition ?? "attachment";

			await env.BUCKET.put(r2Key, attachment.content, {
				httpMetadata: { contentType: attachment.type },
				customMetadata: { filename, messageId },
			});
			stored.push({
				id,
				messageId,
				filename,
				type: attachment.type,
				size: attachment.content.byteLength,
				disposition,
				contentId: attachment.contentId ?? null,
				securityStatus: "safe",
				securityReason: null,
				r2Key,
			});
			await db.insert(messageAttachments).values({
				id,
				messageId,
				filename,
				contentType: attachment.type,
				size: attachment.content.byteLength,
				disposition,
				contentId: attachment.contentId ?? null,
				securityStatus: "safe",
				securityReason: null,
				r2Key,
			});
		}
	} catch (error) {
		await Promise.all(stored.map((attachment) => env.BUCKET.delete(attachment.r2Key)));
		throw error;
	}

	return stored;
}

export async function listMessageAttachments(
	env: CloudflareEnv,
	messageId: string,
): Promise<AttachmentMetadata[]> {
	const db = getDb(env);
	const rows = await db
		.select()
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, messageId));

	return rows.map((attachment) => ({
		id: attachment.id,
		messageId: attachment.messageId,
		filename: attachment.filename,
		type: attachment.contentType,
		size: attachment.size,
		disposition: attachment.disposition as "attachment" | "inline",
		contentId: attachment.contentId,
		securityStatus: attachment.securityStatus,
		securityReason: attachment.securityReason,
	}));
}

export async function getAttachmentForUser(
	env: CloudflareEnv,
	user: SessionUser,
	messageId: string,
	attachmentId: string,
) {
	const attachment = await getAuthorizedAttachment(env, user, messageId, attachmentId);
	if (!attachment) return null;
	const object = await env.BUCKET.get(attachment.r2Key);
	return object ? { attachment, object } : null;
}

export async function getAuthorizedAttachment(
	env: CloudflareEnv,
	user: SessionUser,
	messageId: string,
	attachmentId: string,
) {
	const db = getDb(env);
	const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
	if (
		!message ||
		message.employeeHiddenAt ||
		message.consumedByMessageId ||
		message.securityStatus === "quarantined"
	)
		return null;

	if (message.mailboxId) {
		const access = await getMailboxAccessLevel(db, user, message.mailboxId);
		if (!access?.canRead) return null;
	} else if (message.userId !== user.id) {
		return null;
	}

	const [attachment] = await db
		.select()
		.from(messageAttachments)
		.where(
			and(eq(messageAttachments.id, attachmentId), eq(messageAttachments.messageId, messageId)),
		)
		.limit(1);
	if (!attachment) return null;
	if (attachment.securityStatus === "quarantined") return null;

	return attachment;
}
