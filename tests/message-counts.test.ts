import { describe, expect, it } from "vitest";
import {
	buildMessageCounts,
	buildMessageCountsFromAggregateRows,
} from "../src/app/api/messages/counts/utils";
import type { MessageCountRow } from "../src/app/api/messages/counts/types";

function row(id: string): MessageCountRow {
	return {
		id,
		mailboxId: "mailbox_1",
		folderId: null,
		direction: "inbound",
		status: "received",
		read: false,
		starred: false,
		snoozedUntil: null,
		threadId: "thr_shared",
	};
}

describe("message counts", () => {
	it("counts unread conversations in thread view without changing totals", () => {
		const rows = [row("msg_1"), row("msg_2")];
		expect(buildMessageCounts(rows).folders.inbox).toEqual({ total: 2, unread: 2 });
		expect(buildMessageCounts(rows, true).folders.inbox).toEqual({ total: 2, unread: 1 });
		expect(buildMessageCounts(rows, true).mailboxes[0]).toMatchObject({ unread: 1 });
	});

	it("maps compact D1 aggregates into the client count contract", () => {
		expect(
			buildMessageCountsFromAggregateRows([
				{ scope: "folder", key: "inbox", total: 10, unread: 3, inbox: 0 },
				{ scope: "folder", key: "starred", total: 2, unread: 1, inbox: 0 },
				{ scope: "custom", key: "folder_1", total: 4, unread: 2, inbox: 0 },
				{ scope: "mailbox", key: "mailbox_1", total: 12, unread: 3, inbox: 10 },
			]),
		).toMatchObject({
			folders: {
				inbox: { total: 10, unread: 3 },
				starred: { total: 2, unread: 1 },
				sent: { total: 0, unread: 0 },
			},
			customFolders: { folder_1: { total: 4, unread: 2 } },
			mailboxes: [{ mailboxId: "mailbox_1", total: 12, unread: 3, inbox: 10 }],
		});
	});
});
