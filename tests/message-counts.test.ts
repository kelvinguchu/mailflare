import { describe, expect, it } from "vitest";
import { buildMessageCounts } from "../src/app/api/messages/counts/utils";
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
});
