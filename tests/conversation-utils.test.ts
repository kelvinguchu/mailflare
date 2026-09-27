import { describe, expect, it } from "vitest";
import {
	buildConversationItems,
	buildForwardSubject,
	formatConversationDate,
	formatThreadParticipants,
	getAvatarInitials,
	getInitialExpandedIds,
	getReplyAddresses,
} from "../src/components/conversation/conversation-utils";
import {
	getInboxUnreadDelta,
	getUnreadDeltaForAction,
	isMessageRowUnread,
} from "../src/components/messages/utils";
import type { Message, ThreadParticipant } from "../src/hooks/types";

function message(id: string, overrides: Partial<Message> = {}): Message {
	return {
		id,
		userId: "usr_1",
		mailboxId: "mb_1",
		folderId: null,
		direction: "inbound",
		providerMessageId: null,
		fromAddr: `"Maya Chen" <maya@example.com>`,
		toAddr: "me@example.com",
		ccAddr: "",
		subject: "Invoice",
		snippet: "Hello",
		status: "received",
		read: true,
		starred: false,
		threadId: "thr_1",
		createdAt: "2026-09-01T10:00:00.000Z",
		...overrides,
	};
}

function participant(name: string, overrides: Partial<ThreadParticipant> = {}): ThreadParticipant {
	return {
		name,
		address: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
		isMe: false,
		unread: false,
		...overrides,
	};
}

const labels = (tokens: ReturnType<typeof formatThreadParticipants>) =>
	tokens.map((token) => (token.kind === "gap" ? ".." : token.label));

describe("thread participants", () => {
	it("uses the full name when one person is in the conversation", () => {
		expect(labels(formatThreadParticipants([participant("Contoso Finance")]))).toEqual([
			"Contoso Finance",
		]);
	});

	it("shortens names, shows me, and marks unread senders", () => {
		const tokens = formatThreadParticipants([
			participant("Me", { isMe: true }),
			participant("Maya Chen", { unread: true }),
		]);
		expect(tokens).toEqual([
			{ kind: "name", label: "me", unread: false },
			{ kind: "name", label: "Maya", unread: true },
		]);
	});

	it("keeps the first and last two senders of long conversations", () => {
		expect(
			labels(
				formatThreadParticipants([
					participant("Alice Ng"),
					participant("Bob Oduya"),
					participant("Carol Diaz"),
					participant("Me", { isMe: true }),
				]),
			),
		).toEqual(["Alice", "..", "Carol", "me"]);
	});

	it("falls back to the address local part when a name is an address", () => {
		expect(
			labels(
				formatThreadParticipants([
					participant("billing@vendor.test", { address: "billing@vendor.test" }),
					participant("Me", { isMe: true }),
				]),
			),
		).toEqual(["billing", "me"]);
	});
});

describe("conversation layout", () => {
	const messages = ["a", "b", "c", "d", "e", "f"].map((id, index) =>
		message(id, { createdAt: `2026-09-0${index + 1}T10:00:00.000Z` }),
	);

	it("expands the newest message, unread messages, and the opened message", () => {
		const withUnread = messages.map((item) => (item.id === "c" ? { ...item, read: false } : item));
		expect([...getInitialExpandedIds(withUnread, "a")].sort()).toEqual(["a", "c", "f"]);
	});

	it("never expands unread-looking outbound messages", () => {
		const outbound = messages.map((item) =>
			item.id === "b" ? { ...item, direction: "outbound" as const, read: false } : item,
		);
		expect([...getInitialExpandedIds(outbound)]).toEqual(["f"]);
	});

	it("folds the middle of a long read run into a pill", () => {
		const items = buildConversationItems(messages, new Set(["f"]), false);
		expect(
			items.map((item) =>
				item.kind === "hidden" ? `+${item.count}` : `${item.message.id}${item.expanded ? "*" : ""}`,
			),
		).toEqual(["a", "+3", "e", "f*"]);
	});

	it("shows short runs and everything after Show all", () => {
		expect(buildConversationItems(messages.slice(3), new Set(["f"]), false)).toHaveLength(3);
		expect(buildConversationItems(messages, new Set(["f"]), true)).toHaveLength(6);
	});
});

describe("unread badge deltas", () => {
	const rows = [
		message("a", { read: false }),
		message("b", { read: true }),
		message("c", { read: false, direction: "outbound" }),
	];

	it("counts only received rows whose read state changes", () => {
		expect(getInboxUnreadDelta(rows, true)).toBe(-1);
		expect(getInboxUnreadDelta(rows, false)).toBe(1);
	});

	it("moves the badge only for read and unread actions", () => {
		expect(getUnreadDeltaForAction("read")).toBe(-1);
		expect(getUnreadDeltaForAction("unread")).toBe(1);
		expect(getUnreadDeltaForAction("archive")).toBe(0);
	});
});

describe("replying and list rows", () => {
	it("replies to the sender of received mail and the recipient of sent mail", () => {
		expect(getReplyAddresses(message("a"))).toEqual({
			to: '"Maya Chen" <maya@example.com>',
			cc: "",
			own: "me@example.com",
		});
		expect(
			getReplyAddresses(
				message("b", {
					direction: "outbound",
					fromAddr: "Me <me@example.com>",
					toAddr: "maya@example.com",
				}),
			),
		).toEqual({ to: "maya@example.com", cc: "", own: "me@example.com" });
	});

	it("preserves visible recipients for reply-all while excluding the sender and delivery mailbox", () => {
		expect(
			getReplyAddresses(
				message("reply-all", {
					toAddr: "me@example.com, teammate@example.com",
					ccAddr: "Maya <maya@example.com>, finance@example.com",
					deliveredToAddr: "me@example.com",
				}),
			),
		).toEqual({
			to: '"Maya Chen" <maya@example.com>',
			cc: "teammate@example.com, finance@example.com",
			own: "me@example.com",
		});
	});

	it("does not stack forward prefixes", () => {
		expect(buildForwardSubject("Invoice")).toBe("Fwd: Invoice");
		expect(buildForwardSubject("Fwd: Invoice")).toBe("Fwd: Invoice");
	});

	it("formats full dates with a relative hint", () => {
		expect(formatConversationDate("2026-09-01T10:33:00", new Date("2026-09-14T09:00:00"))).toBe(
			"Sep 1, 10:33 AM (last week)",
		);
	});

	it("builds initials from names and addresses", () => {
		expect(getAvatarInitials("Contoso Finance")).toBe("CF");
		expect(getAvatarInitials("me")).toBe("ME");
	});

	it("treats a conversation row as unread when its thread is unread, even if the newest message is yours", () => {
		const reply = message("r", { direction: "outbound", read: false });
		expect(
			isMessageRowUnread({
				...reply,
				thread: {
					id: "thr_1",
					messageCount: 2,
					unreadCount: 1,
					hasAttachments: false,
					lastMessageAt: reply.createdAt,
					participants: [],
				},
			}),
		).toBe(true);
		expect(isMessageRowUnread(reply)).toBe(false);
	});
});
