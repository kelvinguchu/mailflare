import { describe, expect, it } from "vitest";
import type { MessageCounts } from "@/hooks/types";
import {
	applyRealtimeMessageToCounts,
	doesRealtimeMessageMatch,
	getRealtimeAnnouncement,
	getRealtimeMessageHref,
	getReconnectDelay,
	parseNewMessageEvent,
	parseRealtimeEvent,
} from "@/hooks/message-realtime-utils";
import type { NewMessageNotification, RealtimeMessageListItem } from "@/lib/realtime/types";

const inboxMessage: RealtimeMessageListItem = {
	id: "message-1",
	userId: "owner-1",
	mailboxId: "mailbox-1",
	folderId: null,
	direction: "inbound",
	providerMessageId: "provider-1",
	fromAddr: "sender@example.com",
	toAddr: "inbox@example.com",
	ccAddr: "copy@example.com",
	deliveredToAddr: "inbox@example.com",
	fromContactName: "Sender",
	toContactName: null,
	subject: "Hello",
	snippet: "A safe preview",
	status: "received",
	read: false,
	starred: false,
	snoozedUntil: null,
	threadId: "thread-1",
	createdAt: "2026-09-14T10:00:00.000Z",
};

const notification: NewMessageNotification = {
	version: 1,
	type: "new_message",
	eventId: "new_message:message-1",
	occurredAt: "2026-09-14T10:00:00.000Z",
	publishedAt: "2026-09-14T10:00:00.100Z",
	message: inboxMessage,
};

function emptyCounts(): MessageCounts {
	return {
		folders: {
			inbox: { total: 0, unread: 0 },
			starred: { total: 0, unread: 0 },
			snoozed: { total: 0, unread: 0 },
			sent: { total: 0, unread: 0 },
			drafts: { total: 0, unread: 0 },
			archived: { total: 0, unread: 0 },
			spam: { total: 0, unread: 0 },
			trash: { total: 0, unread: 0 },
		},
		customFolders: {},
		mailboxes: [],
	};
}

describe("message realtime events", () => {
	it("accepts the versioned safe list projection and rejects incomplete frames", () => {
		expect(parseNewMessageEvent(JSON.stringify(notification))).toEqual(notification);
		const eventWithBody = parseNewMessageEvent(
			JSON.stringify({
				...notification,
				message: { ...notification.message, textBody: "must not cross the realtime boundary" },
			}),
		);
		expect(eventWithBody?.message).not.toHaveProperty("textBody");
		expect(
			parseNewMessageEvent(JSON.stringify({ type: "new_message", messageId: "legacy" })),
		).toBeNull();
		expect(parseNewMessageEvent("not-json")).toBeNull();
	});

	it("accepts task-change frames without carrying task notes", () => {
		const event = parseRealtimeEvent(
			JSON.stringify({
				version: 1,
				type: "task_changed",
				eventId: "task:1:assigned:1",
				occurredAt: "2026-09-14T10:00:00.000Z",
				publishedAt: "2026-09-14T10:00:00.100Z",
				task: {
					id: "task-1",
					title: "Review launch copy",
					action: "assigned",
					actorName: "Owner",
					description: "must not cross the realtime boundary",
				},
			}),
		);
		expect(event?.type).toBe("task_changed");
		if (event?.type === "task_changed") expect(event.task).not.toHaveProperty("description");
	});

	it("matches only lists that can safely accept an optimistic insert", () => {
		const inboxParams = new URLSearchParams({
			direction: "inbound",
			status: "received",
			mailboxId: "mailbox-1",
		});
		expect(doesRealtimeMessageMatch(inboxMessage, inboxParams, 0)).toBe(true);
		expect(doesRealtimeMessageMatch(inboxMessage, inboxParams, 25)).toBe(false);
		inboxParams.set("q", "hello");
		expect(doesRealtimeMessageMatch(inboxMessage, inboxParams, 0)).toBe(false);

		const customMessage = { ...inboxMessage, folderId: "folder-1" };
		expect(
			doesRealtimeMessageMatch(customMessage, new URLSearchParams({ folderId: "folder-1" }), 0),
		).toBe(true);
		expect(
			doesRealtimeMessageMatch(customMessage, new URLSearchParams({ status: "received" }), 0),
		).toBe(false);
	});

	it("updates folder, mailbox, and custom-folder counts without mutating unrelated mailboxes", () => {
		const inboxCounts = applyRealtimeMessageToCounts(emptyCounts(), inboxMessage, "mailbox-1");
		expect(inboxCounts.folders.inbox).toEqual({ total: 1, unread: 1 });
		expect(inboxCounts.mailboxes).toEqual([
			{ mailboxId: "mailbox-1", total: 1, unread: 1, inbox: 1 },
		]);

		const unchanged = emptyCounts();
		expect(applyRealtimeMessageToCounts(unchanged, inboxMessage, "mailbox-2")).toBe(unchanged);

		const customMessage = { ...inboxMessage, folderId: "folder-1" };
		const customCounts = applyRealtimeMessageToCounts(emptyCounts(), customMessage);
		expect(customCounts.customFolders["folder-1"]).toEqual({ total: 1, unread: 1 });
		expect(customCounts.folders.inbox).toEqual({ total: 0, unread: 0 });
	});

	it("routes notifications to the actual destination and aggregates announcements", () => {
		expect(getRealtimeMessageHref(inboxMessage)).toBe("/inbox/message-1");
		expect(getRealtimeMessageHref({ ...inboxMessage, status: "spam" })).toBe("/spam/message-1");
		expect(getRealtimeMessageHref({ ...inboxMessage, folderId: "folder-1" })).toBe(
			"/folders/folder-1/message-1",
		);
		expect(getRealtimeAnnouncement([notification, notification])).toContain("2 new emails");
	});

	it("adds bounded jitter to reconnect backoff", () => {
		expect(getReconnectDelay(0, 0)).toBe(1_000);
		expect(getReconnectDelay(0, 0.998)).toBe(1_499);
		expect(getReconnectDelay(10, 0.998)).toBe(30_000);
	});
});
