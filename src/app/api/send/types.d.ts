import type { AttachmentContent } from "@/lib/email/attachment-types";

export interface SendRequestPayload {
	attachments?: AttachmentContent[];
	from: string;
	html?: string;
	includeSignature?: boolean;
	mailboxId?: string;
	subject: string;
	text?: string;
	to: string;
	replyToMessageId?: string | null;
}
