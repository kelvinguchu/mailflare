export type MessageStatus =
	| "received"
	| "sent"
	| "draft"
	| "scheduled"
	| "queued"
	| "canceled"
	| "failed"
	| "archived"
	| "trash"
	| "spam";

export type MessageFolder =
	"inbox" | "starred" | "snoozed" | "sent" | "drafts" | "archived" | "trash" | "spam";

export type MessageDirection = "inbound" | "outbound";

export type Message = {
	id: string;
	userId: string;
	mailboxId: string | null;
	folderId: string | null;
	direction: MessageDirection;
	providerMessageId: string | null;
	deliveryStatus?:
		| "scheduled"
		| "queued"
		| "canceled"
		| "accepted"
		| "delivered"
		| "failed"
		| "suppressed"
		| "unknown"
		| null;
	deliveryDetail?: string | null;
	deliveryUpdatedAt?: string | null;
	securityStatus?: "clean" | "suspicious" | "quarantined";
	securityReason?: string | null;
	spamScore?: number;
	fromAddr: string;
	toAddr: string;
	fromContactName?: string | null;
	toContactName?: string | null;
	subject: string | null;
	snippet: string | null;
	textBody?: string | null;
	htmlBody?: string | null;
	status: MessageStatus | string;
	read: boolean;
	starred: boolean;
	snoozedUntil?: string | null;
	threadId: string | null;
	/** Parent message for drafts and sent replies. */
	replyToMessageId?: string | null;
	hasAttachments?: boolean;
	/** Present when the list was requested with `view=threads`. */
	thread?: ThreadSummary;
	createdAt: string;
};

export type ThreadParticipant = {
	name: string;
	address: string;
	isMe: boolean;
	unread: boolean;
};

export type ThreadSummary = {
	id: string;
	messageCount: number;
	unreadCount: number;
	hasAttachments: boolean;
	lastMessageAt: string;
	participants: ThreadParticipant[];
};

export type MessageThread = {
	id: string;
	subject: string | null;
	messages: Message[];
};

export type MessageReadFilter = "all" | "read" | "unread";

export type MessageFilterOptions = {
	query?: string;
	read?: MessageReadFilter;
	title?: string;
	limit?: number;
	offset?: number;
};

export type MessageListResponse = {
	messages?: Message[];
	total?: number;
	limit?: number;
	offset?: number;
};

export type FolderCount = {
	total: number;
	unread: number;
};

export type MailboxCount = {
	mailboxId: string;
	total: number;
	unread: number;
	inbox: number;
};

export type MessageCounts = {
	folders: Record<MessageFolder, FolderCount>;
	customFolders: Record<string, FolderCount>;
	mailboxes: MailboxCount[];
};

export type MessageCountsDelta = {
	inboxUnreadDelta?: number;
};
