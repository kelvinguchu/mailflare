export type MailboxAutoReplyInput = {
	mailboxId: string;
	userId: string;
	deliveredAddress: string;
	fromAddress: string;
	incomingMessageId?: string | null;
	sourceMessageId: string;
	headers?: Record<string, string>;
};
