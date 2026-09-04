import type { AttachmentContent, StoredAttachment } from "./attachment-types";

export async function stageInboundMessageAttachments(
	env: Pick<CloudflareEnv, "BUCKET">,
	messageId: string,
	deliveryKey: string,
	attachments: AttachmentContent[],
): Promise<StoredAttachment[]> {
	const stored: StoredAttachment[] = [];
	for (let index = 0; index < attachments.length; index += 1) {
		const attachment = attachments[index];
		if (!attachment) continue;
		const filename = sanitizeFilename(attachment.filename);
		const checksum = await sha256Hex(attachment.content);
		const id = `att_in_${deliveryKey}_${index}`;
		const r2Key = `attachments/inbound/${deliveryKey}/${index}-${checksum}-${filename}`;
		const disposition = attachment.disposition ?? "attachment";
		const existing = await env.BUCKET.head(r2Key);
		if (
			!existing ||
			existing.size !== attachment.content.byteLength ||
			existing.customMetadata?.sha256 !== checksum
		) {
			const object = await env.BUCKET.put(r2Key, attachment.content, {
				httpMetadata: { contentType: attachment.type },
				customMetadata: { filename, messageId, deliveryKey, sha256: checksum },
			});
			if (!object || object.size !== attachment.content.byteLength) {
				throw new Error(`Failed to store inbound attachment ${index + 1}`);
			}
		}
		stored.push({
			id,
			messageId,
			filename,
			type: attachment.type,
			size: attachment.content.byteLength,
			disposition,
			contentId: attachment.contentId ?? null,
			r2Key,
		});
	}
	return stored;
}

function sanitizeFilename(filename: string): string {
	const normalized = filename.trim().replace(/[/\\\0]/g, "_");
	return normalized || "attachment";
}

async function sha256Hex(content: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", content);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}
