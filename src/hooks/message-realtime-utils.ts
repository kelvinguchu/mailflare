import { getEmailDisplayName } from "@/lib/email/address";
import type { RealtimeMessageListItem } from "@/lib/realtime/types";
import { parseNewMessageNotification, parseRealtimeNotification } from "@/lib/realtime/validation";
import type { RealtimeNotification, TaskChangeNotification } from "@/lib/realtime/types";
import type { MessageCounts, MessageFolder } from "./types";
import { OPEN_TASK_EVENT, getTaskHref } from "@/components/calendar/task-utils";
import type { NewMessageEvent } from "./message-realtime-types";

export const MESSAGE_REALTIME_EVENT = "mailflare:message-realtime";
export const MESSAGE_RECONCILE_EVENT = "mailflare:messages-reconcile";
export const CALENDAR_REALTIME_EVENT = "mailflare:calendar-realtime";
export const REALTIME_FALLBACK_INTERVAL_MS = 60_000;
export const REALTIME_HEARTBEAT_INTERVAL_MS = 25_000;
export const REALTIME_NOTIFICATION_BATCH_MS = 150;
export const REALTIME_RECONCILE_BATCH_MS = 200;
export const REALTIME_RECONNECT_JITTER_MS = 500;
export const REALTIME_RECONNECT_MAX_MS = 30_000;
export const REALTIME_HIGHLIGHT_MS = 4_000;

export function getRealtimeWebSocketUrl(): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${protocol}//${window.location.host}/api/realtime`;
}

export function getReconnectDelay(attempt: number, random = Math.random()): number {
	const exponentialDelay = 1_000 * 2 ** attempt;
	const jitter = Math.floor(random * REALTIME_RECONNECT_JITTER_MS);
	return Math.min(exponentialDelay + jitter, REALTIME_RECONNECT_MAX_MS);
}

export function parseNewMessageEvent(value: string): NewMessageEvent | null {
	try {
		const payload = JSON.parse(value) as object | null;
		return parseNewMessageNotification(payload);
	} catch {
		return null;
	}
}

export function parseRealtimeEvent(value: string): RealtimeNotification | null {
	try {
		return parseRealtimeNotification(JSON.parse(value) as object | null);
	} catch {
		return null;
	}
}

export function dispatchRealtimeTaskChange(event: TaskChangeNotification): void {
	window.dispatchEvent(
		new CustomEvent<TaskChangeNotification>(CALENDAR_REALTIME_EVENT, { detail: event }),
	);
}

const TASK_CHANGE_VERBS: Record<TaskChangeNotification["task"]["action"], string> = {
	assigned: "assigned you a task",
	reassigned: "reassigned a task",
	updated: "updated a task",
	completed: "completed a task",
	reopened: "reopened a task",
	deleted: "deleted a task",
};

/** Short toast copy; the realtime payload deliberately carries no notes or reminders. */
export function getTaskChangeToast(event: TaskChangeNotification): {
	title: string;
	description: string;
} {
	const actor = event.task.actorName.trim() || "Someone";
	return {
		title: `${actor} ${TASK_CHANGE_VERBS[event.task.action] ?? "changed a task"}`,
		description: event.task.title,
	};
}

export function getTaskChangeAnnouncement(event: TaskChangeNotification): string {
	const { title, description } = getTaskChangeToast(event);
	return `${title}: ${description}`;
}

/** Opens a task in the calendar page if it is mounted, otherwise navigates there. */
export function openTaskFromNotification(taskId: string): void {
	const event = new CustomEvent<string>(OPEN_TASK_EVENT, { detail: taskId, cancelable: true });
	window.dispatchEvent(event);
	if (!event.defaultPrevented) window.location.assign(getTaskHref(taskId));
}

export function dispatchRealtimeMessage(event: NewMessageEvent): boolean {
	const realtimeEvent = new CustomEvent<NewMessageEvent>(MESSAGE_REALTIME_EVENT, {
		detail: event,
		cancelable: true,
	});
	window.dispatchEvent(realtimeEvent);
	return realtimeEvent.defaultPrevented;
}

export function dispatchMessageReconciliation(): void {
	window.dispatchEvent(new Event(MESSAGE_RECONCILE_EVENT));
}

export function doesRealtimeMessageMatch(
	message: RealtimeMessageListItem,
	params: URLSearchParams,
	offset: number,
): boolean {
	if (offset > 0 || params.has("q") || params.has("title")) return false;
	if (params.get("mailboxId") && params.get("mailboxId") !== message.mailboxId) return false;
	if (params.get("direction") && params.get("direction") !== message.direction) return false;
	if (params.get("folderId") && params.get("folderId") !== message.folderId) return false;
	if (params.get("status") && params.get("status") !== message.status) return false;
	if (params.get("starred") === "true" && !message.starred) return false;
	if (params.get("snoozed") === "true" && !isSnoozed(message.snoozedUntil)) return false;
	if (params.get("read") === "read" && !message.read) return false;
	if (params.get("read") === "unread" && message.read) return false;

	if (params.get("status") === "received" && !params.has("folderId")) {
		return message.folderId === null && !isSnoozed(message.snoozedUntil);
	}

	return true;
}

export function applyRealtimeMessageToCounts(
	counts: MessageCounts,
	message: RealtimeMessageListItem,
	mailboxId?: string | null,
): MessageCounts {
	if (mailboxId && mailboxId !== message.mailboxId) return counts;

	const folder = getMessageFolder(message);
	const unread = !message.read;
	const folders = { ...counts.folders };
	if (folder) {
		const current = folders[folder];
		folders[folder] = {
			total: current.total + 1,
			unread: current.unread + (unread ? 1 : 0),
		};
	}
	if (message.starred) {
		const current = folders.starred;
		folders.starred = {
			total: current.total + 1,
			unread: current.unread + (unread ? 1 : 0),
		};
	}

	const customFolders = { ...counts.customFolders };
	if (message.folderId) {
		const current = customFolders[message.folderId] ?? { total: 0, unread: 0 };
		customFolders[message.folderId] = {
			total: current.total + 1,
			unread: current.unread + (unread ? 1 : 0),
		};
	}

	const mailboxes = [...counts.mailboxes];
	const mailboxIndex = mailboxes.findIndex((item) => item.mailboxId === message.mailboxId);
	if (mailboxIndex >= 0) {
		const current = mailboxes[mailboxIndex];
		mailboxes[mailboxIndex] = {
			...current,
			total: current.total + 1,
			unread: current.unread + (unread ? 1 : 0),
			inbox: current.inbox + (folder === "inbox" ? 1 : 0),
		};
	} else {
		mailboxes.push({
			mailboxId: message.mailboxId,
			total: 1,
			unread: unread ? 1 : 0,
			inbox: folder === "inbox" ? 1 : 0,
		});
	}

	return { folders, customFolders, mailboxes };
}

export function getRealtimeMessageHref(message: RealtimeMessageListItem): string {
	return `${getRealtimeMessageFolderHref(message)}/${encodeURIComponent(message.id)}`;
}

export function getRealtimeAnnouncement(events: NewMessageEvent[]): string {
	const latest = events.at(-1);
	if (!latest) return "";
	const sender = latest.message.fromContactName ?? getEmailDisplayName(latest.message.fromAddr);
	const subject = latest.message.subject || "No subject";
	if (events.length === 1) return `New email from ${sender}: ${subject}`;
	return `${events.length} new emails. Latest from ${sender}: ${subject}`;
}

export function showBrowserNewMessageNotification(events: NewMessageEvent[]): void {
	if (
		typeof Notification === "undefined" ||
		Notification.permission !== "granted" ||
		document.visibilityState === "visible"
	) {
		return;
	}

	const latest = events.at(-1);
	if (!latest) return;
	const sender = latest.message.fromContactName ?? getEmailDisplayName(latest.message.fromAddr);
	const notification = new Notification(
		events.length === 1 ? latest.message.subject || "New email" : `${events.length} new emails`,
		{
			body: events.length === 1 ? `From ${sender}` : `Latest from ${sender}`,
			icon: "/favicon.ico",
			tag: "mailflare-new-messages",
		},
	);
	notification.onclick = () => {
		window.focus();
		window.location.replace(getRealtimeMessageHref(latest.message));
		notification.close();
	};
}

function isSnoozed(snoozedUntil: string | null): boolean {
	return !!snoozedUntil && new Date(snoozedUntil) > new Date();
}

function getMessageFolder(message: RealtimeMessageListItem): MessageFolder | null {
	if (isSnoozed(message.snoozedUntil)) return "snoozed";
	if (message.status === "trash") return "trash";
	if (message.status === "spam") return "spam";
	if (message.status === "received" && !message.folderId) return "inbox";
	return null;
}

function getRealtimeMessageFolderHref(message: RealtimeMessageListItem): string {
	if (message.folderId) return `/folders/${encodeURIComponent(message.folderId)}`;
	if (message.status === "spam") return "/spam";
	if (message.status === "trash") return "/trash";
	return "/inbox";
}
