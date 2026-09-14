export interface RealtimeMessageListItem {
	createdAt: string;
	direction: "inbound";
	folderId: string | null;
	fromAddr: string;
	fromContactName: string | null;
	id: string;
	mailboxId: string;
	providerMessageId: string | null;
	read: false;
	snippet: string;
	snoozedUntil: null;
	starred: false;
	status: "received" | "spam" | "trash";
	subject: string | null;
	threadId: string | null;
	toAddr: string;
	toContactName: null;
	userId: string;
}

export interface NewMessageNotification {
	eventId: string;
	message: RealtimeMessageListItem;
	occurredAt: string;
	publishedAt: string;
	type: "new_message";
	version: 1;
}

export interface TaskChangeNotification {
	eventId: string;
	occurredAt: string;
	publishedAt: string;
	task: {
		id: string;
		title: string;
		action: "assigned" | "updated" | "reassigned" | "completed" | "reopened" | "deleted";
		actorName: string;
	};
	type: "task_changed";
	version: 1;
}

export type RealtimeNotification = NewMessageNotification | TaskChangeNotification;

export interface RealtimeNotificationRequest {
	userIds: string[];
	payload: RealtimeNotification;
}
