export type ComposeDraft = {
	id: string;
	mailboxId: string | null;
	fromAddr: string;
	toAddr: string;
	ccAddr: string;
	subject: string | null;
	textBody: string | null;
	htmlBody: string | null;
	replyToMessageId?: string | null;
};

export type DraftResponse = {
	draft?: ComposeDraft;
	error?: string;
};

export type ComposeAttachment = {
	id: string;
	file: File;
};

/** Everything needed to send a message after the composer closes, or to restore it. */
export type ComposeSnapshot = {
	to: string;
	cc: string;
	subject: string;
	text: string;
	attachments: ComposeAttachment[];
	mailboxId: string | null;
	selectedFrom: string;
	/** Formatted From header sent to the API. */
	from: string;
	undoDelaySeconds: string;
	/** Defaults to true; inline replies can leave the mailbox signature off. */
	includeSignature?: boolean;
	/** Idempotency-Key for this exact message; kept so retries converge on one job. */
	sendKey: string;
	/** Draft that still holds this message, when a failed send is reopened. */
	draftId?: string | null;
	/** The message this replies to, so the sent reply joins its conversation. */
	replyToMessageId?: string | null;
};

export type SendResponse = {
	jobId?: string;
	messageId?: string;
	status?: string;
	undoDeadline?: string | null;
	error?: string;
};
