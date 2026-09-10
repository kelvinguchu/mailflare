import type { Message } from "@/hooks/types";
import type { ReplyContentParts } from "@/lib/email/reply-content-types";

export type MessageDetailResponse = {
	message?: Message;
	body?: {
		htmlBody: string | null;
		textBody: string | null;
	} | null;
	attachments?: MessageAttachment[];
	delivery?: {
		status: "queued" | "sending" | "sent" | "failed";
		attemptCount: number;
		error: string | null;
		updatedAt: string;
	} | null;
	unsubscribeUrl?: string | null;
	error?: string;
};

export type MessageAttachment = {
	contentId: string | null;
	disposition: "attachment" | "inline";
	filename: string;
	id: string;
	messageId: string;
	size: number;
	type: string;
	securityStatus: "safe" | "quarantined";
	securityReason: string | null;
};

export type MessageBodyDisplay = ReplyContentParts & {
	htmlBody: string | null;
	hasQuotedContent: boolean;
};
