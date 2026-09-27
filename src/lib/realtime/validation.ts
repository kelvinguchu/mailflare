import type {
	NewMessageNotification,
	RealtimeMessageListItem,
	RealtimeNotification,
	TaskChangeNotification,
} from "./types";

function hasRealtimeMessageShape(value: object | null): value is RealtimeMessageListItem {
	if (!value) return false;
	const message = value as Partial<RealtimeMessageListItem>;
	return (
		typeof message.id === "string" &&
		typeof message.userId === "string" &&
		typeof message.mailboxId === "string" &&
		(message.folderId === null || typeof message.folderId === "string") &&
		message.direction === "inbound" &&
		(message.providerMessageId === null || typeof message.providerMessageId === "string") &&
		typeof message.fromAddr === "string" &&
		typeof message.toAddr === "string" &&
		(message.ccAddr === undefined || typeof message.ccAddr === "string") &&
		(message.deliveredToAddr === undefined || typeof message.deliveredToAddr === "string") &&
		(message.fromContactName === null || typeof message.fromContactName === "string") &&
		message.toContactName === null &&
		(message.subject === null || typeof message.subject === "string") &&
		typeof message.snippet === "string" &&
		(message.status === "received" || message.status === "spam" || message.status === "trash") &&
		message.read === false &&
		message.starred === false &&
		message.snoozedUntil === null &&
		(message.threadId === null || typeof message.threadId === "string") &&
		typeof message.createdAt === "string"
	);
}

export function parseNewMessageNotification(value: object | null): NewMessageNotification | null {
	if (!value) return null;
	const payload = value as Partial<NewMessageNotification>;
	const message = (payload.message as object | null | undefined) ?? null;
	if (
		payload.version === 1 &&
		payload.type === "new_message" &&
		typeof payload.eventId === "string" &&
		typeof payload.occurredAt === "string" &&
		typeof payload.publishedAt === "string" &&
		hasRealtimeMessageShape(message)
	) {
		return {
			version: 1,
			type: "new_message",
			eventId: payload.eventId,
			occurredAt: payload.occurredAt,
			publishedAt: payload.publishedAt,
			message: {
				id: message.id,
				userId: message.userId,
				mailboxId: message.mailboxId,
				folderId: message.folderId,
				direction: "inbound",
				providerMessageId: message.providerMessageId,
				fromAddr: message.fromAddr,
				toAddr: message.toAddr,
				ccAddr: message.ccAddr ?? "",
				deliveredToAddr: message.deliveredToAddr ?? message.toAddr,
				fromContactName: message.fromContactName,
				toContactName: null,
				subject: message.subject,
				snippet: message.snippet,
				status: message.status,
				read: false,
				starred: false,
				snoozedUntil: null,
				threadId: message.threadId,
				createdAt: message.createdAt,
			},
		};
	}
	return null;
}

export function parseTaskChangeNotification(value: object | null): TaskChangeNotification | null {
	if (!value) return null;
	const payload = value as Partial<TaskChangeNotification>;
	const task = payload.task as Partial<TaskChangeNotification["task"]> | null | undefined;
	if (
		payload.version !== 1 ||
		payload.type !== "task_changed" ||
		typeof payload.eventId !== "string" ||
		typeof payload.occurredAt !== "string" ||
		typeof payload.publishedAt !== "string" ||
		!task ||
		typeof task.id !== "string" ||
		typeof task.title !== "string" ||
		typeof task.actorName !== "string" ||
		!isTaskAction(task.action)
	) {
		return null;
	}
	return {
		version: 1,
		type: "task_changed",
		eventId: payload.eventId,
		occurredAt: payload.occurredAt,
		publishedAt: payload.publishedAt,
		task: { id: task.id, title: task.title, action: task.action, actorName: task.actorName },
	};
}

export function parseRealtimeNotification(value: object | null): RealtimeNotification | null {
	return parseNewMessageNotification(value) ?? parseTaskChangeNotification(value);
}

function isTaskAction(
	value: string | undefined,
): value is TaskChangeNotification["task"]["action"] {
	return (
		value === "assigned" ||
		value === "updated" ||
		value === "reassigned" ||
		value === "completed" ||
		value === "reopened" ||
		value === "deleted"
	);
}
