export type DraftPayload = {
	mailboxId?: string | null;
	from?: string;
	to?: string;
	cc?: string;
	subject?: string;
	text?: string;
	html?: string;
	replyToMessageId?: string | null;
};
