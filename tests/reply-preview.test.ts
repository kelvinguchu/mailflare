import { describe, expect, it } from "vitest";
import { buildSnippet } from "@/lib/email/parse";
import { getMessagePreviewText, splitRepliedEmailContent } from "@/lib/email/reply-content-utils";
import {
	addActivityItem,
	getAttentionCount,
	summarizeTasks,
} from "@/components/account-activity-utils";
import type { CalendarTaskRecord } from "@/lib/calendar/types";
import type { TaskChangeNotification } from "@/lib/realtime/types";

describe("getMessagePreviewText", () => {
	it("drops a flattened Gmail quote header from a snippet", () => {
		expect(
			getMessagePreviewText(
				"Test received On Tue, 15 Sept 2026, 19:05 CaliberCode Limited, <info@calibercode.io> wrote: > Hello",
			),
		).toBe("Test received");
	});

	it("drops address-only quote headers", () => {
		expect(getMessagePreviewText("Ok calibercodeltd@gmail.com wrote: > earlier")).toBe("Ok");
	});

	it("keeps plain messages intact", () => {
		expect(getMessagePreviewText("Lunch on Friday?\nLet me know")).toBe(
			"Lunch on Friday? Let me know",
		);
	});

	it("drops a trailing address header even when the quote lines were cut off", () => {
		expect(getMessagePreviewText("Test Received kelvinguchu5@gmail.com wrote:")).toBe(
			"Test Received",
		);
		expect(buildSnippet("Ok\n\ncalibercodeltd@gmail.com wrote:\n> earlier", null)).toBe("Ok");
	});

	it("returns an empty string when nothing but quoted text remains", () => {
		expect(getMessagePreviewText("> only quoted")).toBe("");
	});
});

describe("splitRepliedEmailContent", () => {
	it("recognises a quote header wrapped over two lines", () => {
		const parts = splitRepliedEmailContent(
			[
				"Sounds good",
				"",
				"On Tue, 15 Sept 2026, 19:05 CaliberCode Limited, <info@calibercode.io>",
				"wrote:",
				"> Can we meet?",
			].join("\n"),
		);
		expect(parts.latestContent).toBe("Sounds good");
		expect(parts.quotedContent[0]?.dateLine).toBe("Tue, 15 Sept 2026, 19:05");
		expect(parts.quotedContent[0]?.content).toContain("Can we meet?");
	});

	it("uses the quote address to decide direction", () => {
		const parts = splitRepliedEmailContent("Ok\n\nme@example.com wrote:\n> hi", {
			ownAddress: "me@example.com",
		});
		expect(parts.latestContent).toBe("Ok");
		expect(parts.quotedContent[0]?.direction).toBe("sent");
	});
});

function task(overrides: Partial<CalendarTaskRecord>): CalendarTaskRecord {
	return {
		id: "t",
		creatorUserId: "u1",
		creatorName: "A",
		creatorEmail: "a@example.com",
		assigneeUserId: "u2",
		assigneeName: "B",
		assigneeEmail: "b@example.com",
		completedByUserId: null,
		assignedAt: null,
		mailboxId: null,
		title: "Task",
		description: "",
		dueAt: null,
		timezone: "UTC",
		allDay: false,
		status: "open",
		priority: "none",
		completedAt: null,
		...overrides,
	};
}

describe("account activity", () => {
	const now = new Date("2026-09-17T12:00:00Z");

	it("orders overdue, today, upcoming, then undated and counts urgency", () => {
		const summary = summarizeTasks(
			[
				task({ id: "none" }),
				task({ id: "later", dueAt: "2026-09-20T12:00:00Z" }),
				task({ id: "today", dueAt: "2026-09-17T18:00:00Z" }),
				task({ id: "late", dueAt: "2026-09-16T12:00:00Z" }),
				task({ id: "done", status: "completed" }),
			],
			now,
		);
		expect(summary.visible.map((item) => item.id)).toEqual(["late", "today", "later", "none"]);
		expect(summary).toMatchObject({ overdue: 1, today: 1, total: 4 });
		expect(getAttentionCount(summary, 2, 1)).toBe(5);
	});

	it("keeps the feed newest first without duplicates", () => {
		const event = (id: string, action: TaskChangeNotification["task"]["action"]) =>
			({
				eventId: id,
				occurredAt: now.toISOString(),
				publishedAt: now.toISOString(),
				task: { id: `task-${id}`, title: "Report", action, actorName: "Sam" },
				type: "task_changed",
				version: 1,
			}) satisfies TaskChangeNotification;
		let items = addActivityItem([], event("1", "assigned"));
		items = addActivityItem(items, event("2", "deleted"));
		items = addActivityItem(items, event("1", "assigned"));
		expect(items.map((item) => item.id)).toEqual(["2", "1"]);
		expect(items[0]?.opens).toBe(false);
		expect(items[1]?.title).toBe("Sam assigned you a task");
	});
});
