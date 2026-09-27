import { authFetch } from "@/lib/auth/client";
import type { ComposeAttachment, ComposeDraft, DraftResponse } from "./types";

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

export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Why `files` can't be added to a message that already has `current`, or null when they can. */
export function getAttachmentLimitError(current: File[], files: File[]): string | null {
	if (current.length + files.length > MAX_ATTACHMENTS) {
		return `A message can include at most ${MAX_ATTACHMENTS} attachments`;
	}
	if (files.some((file) => file.size > MAX_ATTACHMENT_BYTES)) {
		return "Each attachment must be 10 MB or smaller";
	}
	const total = [...current, ...files].reduce((sum, file) => sum + file.size, 0);
	if (total > MAX_TOTAL_ATTACHMENT_BYTES) return "Attachments must total 20 MB or less";
	return null;
}
