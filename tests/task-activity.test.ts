import { describe, expect, it } from "vitest";
import {
	activityDayLabel,
	describeTaskActivity,
	describeTaskChange,
	formatActivityTime,
	formatExactTime,
	formatRelativeTime,
	groupTaskActivityByDay,
	type TaskActivityViewer,
} from "../src/components/calendar/task-activity-utils";
import {
	collectTaskChanges,
	readTaskActivityDetails,
	taskActivityPersonIds,
	taskActivityRow,
	withCurrentNames,
	type TaskActivityState,
} from "../src/lib/calendar/task-activity";
import type {
	CalendarTaskActivity,
	TaskActivityChange,
	TaskActivityDetails,
} from "../src/lib/calendar/types";

const NAIROBI = "Africa/Nairobi";
const viewer: TaskActivityViewer = {
	accountId: "usr_me",
	locale: "en-GB",
	timezone: NAIROBI,
	now: new Date("2026-11-25T12:00:00Z"),
};
const ALICE = { id: "usr_alice", name: "Alice Wanjiru" };
const BRIAN = { id: "usr_brian", name: "Brian Otieno" };
const ME = { id: "usr_me", name: "Sam" };

function entry(overrides: Partial<CalendarTaskActivity> = {}): CalendarTaskActivity {
	return {
		id: "aud_1",
		action: "updated",
		actorUserId: ALICE.id,
		actorName: ALICE.name,
		actorEmail: "alice@calibercode.io",
		createdAt: "2026-11-25T09:00:00.000Z",
		details: null,
		...overrides,
	};
}

/** The sentence after the actor for a save that changed one field. */
function said(change: TaskActivityChange, actorUserId: string | null = ALICE.id) {
	return describeTaskChange(change, actorUserId, viewer);
}

const at = (iso: string) => ({ at: iso, allDay: false, timezone: NAIROBI });

describe("describing task changes", () => {
	it("names the old and new title", () => {
		expect(said({ field: "title", from: "Draft quote", to: "Send quote" })).toBe(
			"renamed this from “Draft quote” to “Send quote”",
		);
	});

	it("says whether notes were added, edited or removed, without quoting them", () => {
		expect(said({ field: "description", change: "added" })).toBe("added notes");
		expect(said({ field: "description", change: "edited" })).toBe("edited the notes");
		expect(said({ field: "description", change: "removed" })).toBe("removed the notes");
	});

	it("sets, changes and clears the due date in the task's timezone", () => {
		const from = at("2026-11-12T07:00:00.000Z");
		const to = at("2026-11-14T06:00:00.000Z");
		expect(said({ field: "due", from, to })).toBe(
			"changed the due date from 12 Nov, 10:00 to 14 Nov, 09:00",
		);
		expect(said({ field: "due", from: null, to })).toBe("set the due date to 14 Nov, 09:00");
		expect(said({ field: "due", from, to: null })).toBe("cleared the due date (was 12 Nov, 10:00)");
	});

	it("shows all-day dates without a time and names a timezone that is not the viewer's", () => {
		const allDay = { at: "2026-11-14T00:00:00.000Z", allDay: true, timezone: NAIROBI };
		expect(formatActivityTime(allDay, viewer)).toBe("14 Nov");
		expect(formatActivityTime(at("2026-11-12T07:00:00.000Z"), { ...viewer, timezone: "UTC" })).toBe(
			"12 Nov, 10:00 GMT+3",
		);
		expect(formatActivityTime(at("2027-01-05T07:00:00.000Z"), viewer)).toBe("5 Jan 2027, 10:00");
	});

	it("describes priority set, changed and removed with its labels", () => {
		expect(said({ field: "priority", from: "none", to: "high" })).toBe("set the priority to High");
		expect(said({ field: "priority", from: "low", to: "medium" })).toBe(
			"changed the priority from Low to Medium",
		);
		expect(said({ field: "priority", from: "high", to: "none" })).toBe(
			"removed the priority (was High)",
		);
	});

	it("names who a task was assigned or reassigned to, from the viewer's side", () => {
		expect(said({ field: "assignee", from: null, to: BRIAN })).toBe(
			"assigned this to Brian Otieno",
		);
		expect(said({ field: "assignee", from: BRIAN, to: ME })).toBe(
			"reassigned this from Brian Otieno to you",
		);
		expect(said({ field: "assignee", from: ME, to: BRIAN })).toBe(
			"reassigned this from you to Brian Otieno",
		);
		expect(said({ field: "assignee", from: BRIAN, to: ALICE })).toBe(
			"reassigned this from Brian Otieno to themselves",
		);
		expect(said({ field: "assignee", from: BRIAN, to: ME }, ME.id)).toBe(
			"reassigned this from Brian Otieno to yourself",
		);
		expect(said({ field: "assignee", from: null, to: { id: "usr_gone", name: null } })).toBe(
			"assigned this to a removed account",
		);
	});

	it("describes repeat rules set, changed and stopped", () => {
		expect(said({ field: "repeat", from: null, to: "FREQ=WEEKLY;BYDAY=MO" })).toBe(
			"set this to repeat weekly on Mon",
		);
		expect(said({ field: "repeat", from: "FREQ=WEEKLY;BYDAY=MO", to: "FREQ=MONTHLY" })).toBe(
			"changed the repeat from weekly on Mon to monthly",
		);
		expect(said({ field: "repeat", from: "FREQ=DAILY", to: null })).toBe(
			"stopped this task repeating (was every day)",
		);
		expect(said({ field: "repeat", from: "nonsense", to: "FREQ=DAILY;COUNT=3" })).toBe(
			"changed how this repeats",
		);
	});

	it("describes reminders added, moved and removed at their own times", () => {
		const reminder = { field: "reminder" as const, timezone: NAIROBI, channel: "in_app" as const };
		expect(said({ ...reminder, from: null, to: "2026-11-14T05:30:00.000Z" })).toBe(
			"added a reminder for 14 Nov, 08:30",
		);
		expect(
			said({
				...reminder,
				channel: "email",
				from: "2026-11-14T05:30:00.000Z",
				to: "2026-11-14T05:45:00.000Z",
			}),
		).toBe("moved an email reminder from 14 Nov, 08:30 to 14 Nov, 08:45");
		expect(said({ ...reminder, from: "2026-11-14T05:30:00.000Z", to: null })).toBe(
			"removed a reminder for 14 Nov, 08:30",
		);
	});

	it("mentions a changed mailbox", () => {
		expect(said({ field: "mailbox" })).toBe("changed the linked mailbox");
	});
});

describe("describing task activity entries", () => {
	it("turns one change into one sentence", () => {
		expect(
			describeTaskActivity(
				entry({
					details: {
						changes: [
							{
								field: "due",
								from: at("2026-11-12T07:00:00.000Z"),
								to: at("2026-11-14T06:00:00.000Z"),
							},
						],
					},
				}),
				viewer,
			),
		).toEqual({
			actor: "Alice Wanjiru",
			text: "changed the due date from 12 Nov, 10:00 to 14 Nov, 09:00",
			changes: [],
		});
		expect(
			describeTaskActivity(
				entry({
					action: "reassigned",
					actorUserId: ME.id,
					details: { changes: [{ field: "assignee", from: ME, to: BRIAN }] },
				}),
				viewer,
			),
		).toEqual({ actor: "You", text: "reassigned this from yourself to Brian Otieno", changes: [] });
	});

	it("lists every change of one save in a single entry", () => {
		const described = describeTaskActivity(
			entry({
				action: "reassigned",
				details: {
					changes: [
						{ field: "title", from: "Quote", to: "Send quote" },
						{ field: "assignee", from: ALICE, to: BRIAN },
						{ field: "priority", from: "none", to: "high" },
					],
				},
			}),
			viewer,
		);
		expect(described).toEqual({
			actor: "Alice Wanjiru",
			text: "made 3 changes",
			changes: [
				"Renamed this from “Quote” to “Send quote”",
				"Reassigned this from themselves to Brian Otieno",
				"Set the priority to High",
			],
		});
	});

	it("describes creation, the next occurrence, completion, reopening and deletion", () => {
		expect(describeTaskActivity(entry({ action: "created" }), viewer).text).toBe(
			"created this task",
		);
		expect(
			describeTaskActivity(entry({ action: "created", details: { assignee: ME } }), viewer).text,
		).toBe("created this task and assigned it to you");
		expect(
			describeTaskActivity(entry({ action: "created", details: { assignee: BRIAN } }), viewer).text,
		).toBe("created this task and assigned it to Brian Otieno");
		expect(
			describeTaskActivity(entry({ action: "created", details: { nextOccurrence: true } }), viewer)
				.text,
		).toBe("created this occurrence by completing the previous one");
		expect(describeTaskActivity(entry({ action: "completed" }), viewer).text).toBe(
			"marked this complete",
		);
		expect(describeTaskActivity(entry({ action: "reopened" }), viewer).text).toBe(
			"reopened this task",
		);
		expect(
			describeTaskActivity(entry({ action: "deleted", details: { title: "Send quote" } }), viewer)
				.text,
		).toBe("deleted “Send quote”");
	});

	it("still reads sensibly for entries recorded before changes were stored", () => {
		const legacy = (action: CalendarTaskActivity["action"]) =>
			describeTaskActivity(entry({ action, details: null }), viewer);
		expect(legacy("updated")).toEqual({
			actor: "Alice Wanjiru",
			text: "edited the details",
			changes: [],
		});
		expect(legacy("reassigned").text).toBe("changed the assignee");
		expect(legacy("deleted").text).toBe("deleted this task");
		expect(legacy("created").text).toBe("created this task");
		expect(
			describeTaskActivity(
				entry({ action: "updated", details: { changes: [] } as TaskActivityDetails }),
				viewer,
			).text,
		).toBe("edited the details");
		expect(
			describeTaskActivity(entry({ action: "archived" as CalendarTaskActivity["action"] }), viewer)
				.text,
		).toBe("changed this task");
		expect(
			describeTaskActivity(entry({ actorUserId: null, actorName: null, actorEmail: null }), viewer)
				.actor,
		).toBe("A removed account");
	});
});

describe("activity times and days", () => {
	const now = new Date(2026, 10, 25, 12, 0, 0);
	const local = (day: number, hour: number, minute = 0) =>
		new Date(2026, 10, day, hour, minute).toISOString();

	it("shows relative times that agree with the day headings", () => {
		expect(formatRelativeTime(local(25, 11, 59), now, "en")).toBe("1 minute ago");
		expect(formatRelativeTime(new Date(now.getTime() - 20_000).toISOString(), now, "en")).toBe(
			"just now",
		);
		expect(formatRelativeTime(local(25, 11, 55), now, "en")).toBe("5 minutes ago");
		expect(formatRelativeTime(local(25, 9), now, "en")).toBe("3 hours ago");
		expect(formatRelativeTime(local(24, 8), now, "en")).toBe("yesterday");
		expect(formatRelativeTime(local(23, 13), now, "en")).toBe("2 days ago");
		expect(formatRelativeTime(local(4, 13), now, "en")).toBe("3 weeks ago");
		expect(formatRelativeTime(new Date(2025, 10, 1).toISOString(), now, "en")).toBe("last year");
	});

	it("gives the exact time for hover titles", () => {
		expect(formatExactTime("2026-11-12T07:00:00.000Z", "en-GB", "UTC")).toBe(
			"Thursday, 12 November 2026 at 07:00",
		);
	});

	it("groups entries under Today, Yesterday and dated headings, newest first", () => {
		const items = [
			entry({ id: "a", createdAt: local(25, 11) }),
			entry({ id: "b", createdAt: local(25, 8) }),
			entry({ id: "c", createdAt: local(24, 17) }),
			entry({ id: "d", createdAt: local(10, 9) }),
			entry({ id: "e", createdAt: new Date(2025, 11, 31, 9).toISOString() }),
		];
		const days = groupTaskActivityByDay(items, now, "en-GB");
		expect(days.map((day) => [day.label, day.items.map((item) => item.id)])).toEqual([
			["Today", ["a", "b"]],
			["Yesterday", ["c"]],
			["Tue 10 Nov", ["d"]],
			["Wed, 31 Dec 2025", ["e"]],
		]);
		expect(activityDayLabel("2026-11-25", now)).toBe("Today");
	});
});

describe("recording task changes", () => {
	const before: TaskActivityState = {
		title: "Quote",
		description: "",
		dueAt: new Date("2026-11-12T07:00:00.000Z"),
		allDay: false,
		timezone: NAIROBI,
		priority: "none",
		recurrenceRule: null,
		mailboxId: null,
		assignee: ALICE,
	};

	it("collects every changed field of one save, in display order", () => {
		expect(
			collectTaskChanges(before, {
				...before,
				title: "Send quote",
				description: "Use the new rates",
				dueAt: new Date("2026-11-14T06:00:00.000Z"),
				priority: "high",
				recurrenceRule: "FREQ=WEEKLY",
				mailboxId: "mbx_1",
				assignee: BRIAN,
			}),
		).toEqual([
			{ field: "title", from: "Quote", to: "Send quote" },
			{ field: "assignee", from: ALICE, to: BRIAN },
			{
				field: "due",
				from: { at: "2026-11-12T07:00:00.000Z", allDay: false, timezone: NAIROBI },
				to: { at: "2026-11-14T06:00:00.000Z", allDay: false, timezone: NAIROBI },
			},
			{ field: "repeat", from: null, to: "FREQ=WEEKLY" },
			{ field: "priority", from: "none", to: "high" },
			{ field: "description", change: "added" },
			{ field: "mailbox" },
		]);
	});

	it("ignores changes nobody would see", () => {
		expect(collectTaskChanges(before, { ...before })).toEqual([]);
		expect(collectTaskChanges(before, { ...before, description: "   " })).toEqual([]);
		const allDay = { ...before, dueAt: new Date("2026-11-14T00:00:00.000Z"), allDay: true };
		expect(collectTaskChanges(allDay, { ...allDay, timezone: "Europe/London" })).toEqual([]);
		expect(collectTaskChanges(before, { ...before, timezone: "Europe/London" })).toHaveLength(1);
	});

	it("stores details on the activity row and reads them back", () => {
		const row = taskActivityRow({
			actorUserId: ALICE.id,
			targetUserId: BRIAN.id,
			action: "calendar.task_reassigned",
			taskId: "tsk_1",
			metadata: { assigneeUserId: BRIAN.id },
			details: { changes: [{ field: "assignee", from: ALICE, to: BRIAN }] },
		});
		expect(JSON.parse(row.metadata)).toEqual({
			taskId: "tsk_1",
			assigneeUserId: BRIAN.id,
			details: { changes: [{ field: "assignee", from: ALICE, to: BRIAN }] },
		});
		expect(readTaskActivityDetails(row.metadata, "reassigned", ALICE.id)).toEqual({
			changes: [{ field: "assignee", from: ALICE, to: BRIAN }],
		});
		expect(
			JSON.parse(
				taskActivityRow({
					actorUserId: ALICE.id,
					targetUserId: ALICE.id,
					action: "calendar.task_completed",
					taskId: "tsk_1",
					details: { changes: [] },
				}).metadata,
			),
		).toEqual({ taskId: "tsk_1" });
	});

	it("drops malformed stored changes and keeps the valid ones", () => {
		const metadata = JSON.stringify({
			taskId: "tsk_1",
			details: {
				changes: [
					{ field: "priority", from: "urgent", to: "high" },
					{ field: "due", from: null, to: null },
					{ field: "title", from: 1, to: "x" },
					{ field: "secret" },
					{ field: "priority", from: "low", to: "high" },
				],
			},
		});
		expect(readTaskActivityDetails(metadata, "updated", ALICE.id)).toEqual({
			changes: [{ field: "priority", from: "low", to: "high" }],
		});
		expect(readTaskActivityDetails("{not json", "updated", ALICE.id)).toBeNull();
		expect(readTaskActivityDetails(null, "completed", ALICE.id)).toBeNull();
	});

	it("recovers the people named by entries recorded before details existed", () => {
		const legacyReassign = JSON.stringify({
			taskId: "tsk_1",
			previousAssigneeUserId: ALICE.id,
			assigneeUserId: BRIAN.id,
		});
		const details = readTaskActivityDetails(legacyReassign, "reassigned", ALICE.id);
		expect(details).toEqual({
			changes: [
				{
					field: "assignee",
					from: { id: ALICE.id, name: null },
					to: { id: BRIAN.id, name: null },
				},
			],
		});
		expect(taskActivityPersonIds(details)).toEqual([ALICE.id, BRIAN.id]);
		expect(withCurrentNames(details, new Map([[BRIAN.id, BRIAN.name]]))).toEqual({
			changes: [{ field: "assignee", from: { id: ALICE.id, name: null }, to: BRIAN }],
		});
		const legacyUpdate = JSON.stringify({
			taskId: "tsk_1",
			previousAssigneeUserId: ALICE.id,
			assigneeUserId: ALICE.id,
		});
		expect(readTaskActivityDetails(legacyUpdate, "updated", ALICE.id)).toBeNull();
		expect(
			readTaskActivityDetails(
				JSON.stringify({ taskId: "tsk_1", assigneeUserId: BRIAN.id }),
				"created",
				ALICE.id,
			),
		).toEqual({ assignee: { id: BRIAN.id, name: null } });
		expect(
			readTaskActivityDetails(
				JSON.stringify({ taskId: "tsk_2", previousTaskId: "tsk_1", recurrenceSeriesId: "tsk_1" }),
				"created",
				ALICE.id,
			),
		).toEqual({ nextOccurrence: true });
	});
});
