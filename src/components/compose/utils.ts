import { authFetch } from "@/lib/auth/client";
import type { ComposeAttachment, ComposeDraft, DraftResponse } from "./types";
import { attachmentLimitError } from "@/lib/email/limits";
export {
	MAX_ATTACHMENT_COUNT as MAX_ATTACHMENTS,
	MAX_ATTACHMENT_SIZE as MAX_ATTACHMENT_BYTES,
	MAX_TOTAL_ATTACHMENT_SIZE as MAX_TOTAL_ATTACHMENT_BYTES,
} from "@/lib/email/limits";

export async function fetchDraft(draftId: string): Promise<ComposeDraft> {
	const res = await authFetch(`/api/drafts/${draftId}`);
	const json = (await res.json()) as DraftResponse;

	if (!res.ok || !json.draft) {
		throw new Error(json.error ?? "Failed to load draft");
	}

	return json.draft;
}

export function buildSendFormData(input: {
	attachments: ComposeAttachment[];
	from: string;
	includeSignature?: boolean;
	mailboxId?: string;
	subject: string;
	text: string;
	to: string;
	cc?: string;
	replyToMessageId?: string | null;
	forwardMessageId?: string | null;
}): FormData {
	const form = new FormData();
	form.set("from", input.from);
	form.set("to", input.to);
	if (input.cc) form.set("cc", input.cc);
	form.set("subject", input.subject);
	form.set("text", input.text);
	if (input.includeSignature !== undefined) {
		form.set("includeSignature", String(input.includeSignature));
	}
	if (input.mailboxId) form.set("mailboxId", input.mailboxId);
	if (input.replyToMessageId) form.set("replyToMessageId", input.replyToMessageId);
	if (input.forwardMessageId) form.set("forwardMessageId", input.forwardMessageId);
	for (const attachment of input.attachments) {
		form.append("attachments", attachment.file);
	}
	return form;
}

/**
 * Removes one signature block inserted by the legacy text composer. New sends ask the server to
 * append the mailbox's canonical signature, so retaining this block would duplicate it.
 */
export function removeLegacySignature(text: string, signature: string | null | undefined): string {
	const value = signature?.trim() ?? "";
	if (!value) return text;
	if (text.trim() === value) return "";
	const block = `\n\n${value}`;
	const index = text.indexOf(block);
	if (index < 0) return text;
	return text.slice(0, index) + text.slice(index + block.length);
}

export function formatAttachmentSize(size: number): string {
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function applyMailboxSignature(
	text: string,
	previousSignature: string | null | undefined,
	nextSignature: string | null | undefined,
): string {
	const previousBlock = formatSignatureBlock(previousSignature);
	const nextBlock = formatSignatureBlock(nextSignature);
	if (previousBlock && text.includes(previousBlock)) {
		return text.replace(previousBlock, nextBlock);
	}
	if (!nextBlock || text.includes(nextBlock)) return text;
	if (!text) return nextBlock;
	if (/^\s*[^\n]+ wrote:\n>/i.test(text)) return `${nextBlock}${text}`;
	return `${text}${nextBlock}`;
}

function formatSignatureBlock(signature: string | null | undefined): string {
	const value = signature?.trim() ?? "";
	return value ? `\n\n${value}` : "";
}

/** Why `files` can't be added to a message that already has `current`, or null when they can. */
export function getAttachmentLimitError(current: File[], files: File[]): string | null {
	return attachmentLimitError([...current, ...files]);
}
