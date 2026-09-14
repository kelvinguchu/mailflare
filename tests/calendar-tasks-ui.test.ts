import { describe, expect, it } from "vitest";
import {
	buildTaskCreateInput,
	buildTaskPatch,
	describeTaskActivity,
	getTaskFormValues,
	getTaskListParams,
	getTaskPermissions,
	getTaskRelationLabel,
	groupTasks,
	isTaskFormDirty,
	taskMatchesListParams,
} from "../src/components/calendar/task-utils";
import { getTaskChangeAnnouncement, getTaskChangeToast } from "../src/hooks/message-realtime-utils";
import type { CalendarTaskRecord } from "../src/lib/calendar/types";
import type { TaskChangeNotification } from "../src/lib/realtime/types";

const NOW = new Date("2026-09-14T12:00:00");

function task(overrides: Partial<CalendarTaskRecord> = {}): CalendarTaskRecord {
	return {
		id: "tsk_1",
		creatorUserId: "usr_owner",
		creatorName: "Maya Chen",
		creatorEmail: "maya@example.com",
		assigneeUserId: "usr_me",
		assigneeName: "Sam Rivera",
		assigneeEmail: "sam@example.com",
		completedByUserId: null,
		assignedAt: "2026-09-10T09:00:00.000Z",
		mailboxId: null,
		title: "Review launch copy",
		description: "",
		dueAt: null,
		timezone: "UTC",
		allDay: false,
		status: "open",
		priority: "none",
		completedAt: null,
		createdAt: "2026-09-10T09:00:00.000Z",
		updatedAt: "2026-09-10T09:00:00.000Z",
		...overrides,
	};
}

describe("task lists", () => {
	it("maps status filters onto the API parameters", () => {
		expect(getTaskListParams("assigned", "overdue")).toEqual({
			scope: "assigned",
			status: "open",
			overdue: true,
		});
		expect(getTaskListParams("created", "all")).toEqual({ scope: "created", status: "all" });
	});

	it("groups tasks by what needs attention first", () => {
		const groups = groupTasks(
			[
				task({ id: "none" }),
				task({ id: "done", status: "completed", completedAt: "2026-09-13T10:00:00.000Z" }),
				task({ id: "later", dueAt: "2026-09-20T09:00:00" }),
				task({ id: "late", dueAt: "2026-09-13T09:00:00" }),
				task({ id: "today", dueAt: "2026-09-14T17:00:00" }),
			],
			"all",
			NOW,
		);
		expect(groups.map((group) => [group.id, group.tasks.map((item) => item.id)])).toEqual([
			["overdue", ["late"]],
			["today", ["today"]],
			["upcoming", ["later"]],
			["none", ["none"]],
			["completed", ["done"]],
		]);
		expect(groupTasks([task({ dueAt: "2026-09-13T09:00:00" })], "overdue", NOW)).toHaveLength(1);
		expect(groupTasks([task()], "overdue", NOW)).toHaveLength(0);
	});

	it("places optimistic tasks only in lists they belong to", () => {
		const mine = task({ creatorUserId: "usr_me", assigneeUserId: "usr_me" });
		const forMaya = task({ creatorUserId: "usr_me", assigneeUserId: "usr_owner" });
		expect(taskMatchesListParams(mine, { scope: "assigned", status: "open" }, "usr_me")).toBe(true);
		expect(taskMatchesListParams(forMaya, { scope: "assigned", status: "open" }, "usr_me")).toBe(
			false,
		);
		expect(taskMatchesListParams(forMaya, { scope: "created", status: "open" }, "usr_me")).toBe(
			true,
		);
		expect(taskMatchesListParams(mine, { scope: "all", status: "completed" }, "usr_me")).toBe(
			false,
		);
		expect(
			taskMatchesListParams(mine, { scope: "all", start: "2026-09-01T00:00:00Z" }, "usr_me"),
		).toBe(false);
	});
});

describe("task permissions and people", () => {
	it("lets only the creator reassign and the creator or an admin delete", () => {
		const assigned = task();
		expect(getTaskPermissions(assigned, { id: "usr_me" })).toEqual({
			canEdit: true,
			canComplete: true,
			canReassign: false,
			canDelete: false,
		});
		expect(getTaskPermissions(assigned, { id: "usr_owner" })).toMatchObject({
			canReassign: true,
			canDelete: true,
		});
		expect(getTaskPermissions(assigned, { id: "usr_admin", role: "admin" })).toMatchObject({
			canEdit: false,
			canReassign: false,
			canDelete: true,
		});
		expect(getTaskPermissions(assigned, null)).toMatchObject({
			canReassign: false,
			canDelete: false,
		});
	});

	it("describes the other person from the viewer's side", () => {
		expect(getTaskRelationLabel(task(), "usr_me", "assigned")).toBe("From Maya");
		expect(getTaskRelationLabel(task(), "usr_owner", "created")).toBe("For Sam");
		expect(
			getTaskRelationLabel(task({ assigneeUserId: "usr_owner" }), "usr_owner", "all"),
		).toBeNull();
	});

	it("attributes activity to you or the named actor", () => {
		const base = { id: "a1", createdAt: "2026-09-14T10:00:00.000Z", actorEmail: null };
		expect(
			describeTaskActivity(
				{ ...base, action: "reassigned", actorUserId: "usr_owner", actorName: "Maya Chen" },
				"usr_me",
			),
		).toEqual({ actor: "Maya Chen", text: "changed the assignee" });
		expect(
			describeTaskActivity(
				{ ...base, action: "completed", actorUserId: "usr_me", actorName: "Sam" },
				"usr_me",
			),
		).toEqual({ actor: "You", text: "marked it complete" });
		expect(
			describeTaskActivity(
				{ ...base, action: "created", actorUserId: null, actorName: null },
				"usr_me",
			).actor,
		).toBe("A removed account");
	});
});

describe("task form", () => {
	const defaults = { timezone: "Africa/Nairobi", assigneeUserId: "usr_me", now: NOW };

	it("creates all-day and timed tasks with the API's date formats", () => {
		const values = getTaskFormValues(null, { ...defaults, title: "  File report  " });
		expect(
			buildTaskCreateInput({ ...values, dueMode: "date", dueDate: "2026-09-20" }),
		).toMatchObject({
			title: "File report",
			dueAt: "2026-09-20",
			allDay: true,
			assigneeUserId: "usr_me",
		});
		expect(
			buildTaskCreateInput({ ...values, dueMode: "time", dueTime: "2026-09-20T09:30" }),
		).toMatchObject({ dueAt: "2026-09-20T09:30:00+03:00", allDay: false });
		expect(() => buildTaskCreateInput({ ...values, title: " " })).toThrow(/title/);
	});

	it("sends only changed fields and never an assignee the viewer can't change", () => {
		const baseline = getTaskFormValues(task(), defaults);
		const edited = { ...baseline, priority: "high" as const, assigneeUserId: "usr_other" };
		expect(buildTaskPatch(edited, baseline, false)).toEqual({ priority: "high" });
		expect(buildTaskPatch(edited, baseline, true)).toEqual({
			priority: "high",
			assigneeUserId: "usr_other",
		});
		expect(isTaskFormDirty(baseline, baseline)).toBe(false);
	});

	it("ignores hidden due inputs when the task has no date", () => {
		const baseline = getTaskFormValues(task(), defaults);
		expect(isTaskFormDirty({ ...baseline, dueDate: "2030-01-01" }, baseline)).toBe(false);
		expect(
			buildTaskPatch({ ...baseline, dueMode: "date", dueDate: "2026-09-18" }, baseline, false),
		).toEqual({ dueAt: "2026-09-18", allDay: true, timezone: "UTC" });
	});
});

describe("task notifications", () => {
	function event(action: TaskChangeNotification["task"]["action"]): TaskChangeNotification {
		return {
			version: 1,
			type: "task_changed",
			eventId: `task:tsk_1:${action}:1`,
			occurredAt: "2026-09-14T10:00:00.000Z",
			publishedAt: "2026-09-14T10:00:00.100Z",
			task: { id: "tsk_1", title: "Review launch copy", action, actorName: "Maya Chen" },
		};
	}

	it("says who did what without task details", () => {
		expect(getTaskChangeToast(event("assigned"))).toEqual({
			title: "Maya Chen assigned you a task",
			description: "Review launch copy",
		});
		expect(getTaskChangeToast(event("completed")).title).toBe("Maya Chen completed a task");
		expect(getTaskChangeAnnouncement(event("deleted"))).toBe(
			"Maya Chen deleted a task: Review launch copy",
		);
	});
});
