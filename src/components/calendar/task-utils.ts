import type {
	CalendarPriority,
	CalendarTaskActivity,
	CalendarTaskInput,
	CalendarTaskListParams,
	CalendarTaskPatchInput,
	CalendarTaskRecord,
	CalendarTaskScope,
} from "@/lib/calendar/types";
import {
	dateKey,
	instantToWallClock,
	toOffsetDateTime,
	utcDateKey,
	wallClockToInstant,
} from "@/lib/calendar/wall-clock";
import { isTaskOverdue, taskDueKey } from "./calendar-utils";

export type TaskStatusFilter = "open" | "overdue" | "completed" | "all";
export type TaskDueState = "overdue" | "today" | "upcoming" | "none" | "completed";

export type TaskGroup = {
	id: TaskDueState;
	label: string;
	tasks: CalendarTaskRecord[];
};

export type TaskAccount = { id: string; role?: string } | null | undefined;

export type TaskPermissions = {
	canEdit: boolean;
	canComplete: boolean;
	canReassign: boolean;
	canDelete: boolean;
};

export const TASK_SCOPE_OPTIONS: Array<{
	value: CalendarTaskScope;
	label: string;
	shortLabel: string;
}> = [
	{ value: "assigned", label: "Assigned to me", shortLabel: "Assigned to me" },
	{ value: "created", label: "Created by me", shortLabel: "Created by me" },
	{ value: "all", label: "All related tasks", shortLabel: "All" },
];

export const TASK_STATUS_OPTIONS: Array<{ value: TaskStatusFilter; label: string }> = [
	{ value: "open", label: "Open" },
	{ value: "overdue", label: "Overdue" },
	{ value: "completed", label: "Completed" },
	{ value: "all", label: "All" },
];

const GROUP_LABELS: Record<TaskDueState, string> = {
	overdue: "Overdue",
	today: "Today",
	upcoming: "Upcoming",
	none: "No due date",
	completed: "Completed",
};

const PRIORITY_RANK: Record<CalendarPriority, number> = { high: 0, medium: 1, low: 2, none: 3 };

export function getTaskListParams(
	scope: CalendarTaskScope,
	status: TaskStatusFilter,
): CalendarTaskListParams {
	if (status === "overdue") return { scope, status: "open", overdue: true };
	return { scope, status };
}

export function getTaskDueState(task: CalendarTaskRecord, now = new Date()): TaskDueState {
	if (task.status === "completed") return "completed";
	if (!task.dueAt) return "none";
	if (isTaskOverdue(task, now)) return "overdue";
	return taskDueKey(task) === dateKey(now) ? "today" : "upcoming";
}

function byDueThenPriority(a: CalendarTaskRecord, b: CalendarTaskRecord): number {
	const due = (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
	return due || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

function byNewest(a: CalendarTaskRecord, b: CalendarTaskRecord): number {
	return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}

function byPriorityThenNewest(a: CalendarTaskRecord, b: CalendarTaskRecord): number {
	return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byNewest(a, b);
}

function byCompletedNewest(a: CalendarTaskRecord, b: CalendarTaskRecord): number {
	return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
}

/**
 * Buckets a task list for scanning: overdue first, then today, upcoming, undated, and
 * completed. The status filter decides which buckets can appear.
 */
export function groupTasks(
	tasks: CalendarTaskRecord[],
	status: TaskStatusFilter,
	now = new Date(),
): TaskGroup[] {
	const buckets: Record<TaskDueState, CalendarTaskRecord[]> = {
		overdue: [],
		today: [],
		upcoming: [],
		none: [],
		completed: [],
	};
	for (const task of tasks) buckets[getTaskDueState(task, now)].push(task);
	buckets.overdue.sort(byDueThenPriority);
	buckets.today.sort(byDueThenPriority);
	buckets.upcoming.sort(byDueThenPriority);
	buckets.none.sort(byPriorityThenNewest);
	buckets.completed.sort(byCompletedNewest);

	const order: Record<TaskStatusFilter, TaskDueState[]> = {
		open: ["overdue", "today", "upcoming", "none"],
		// The API treats an all-day task as overdue from UTC midnight; the list uses the viewer's day.
		overdue: ["overdue"],
		completed: ["completed"],
		all: ["overdue", "today", "upcoming", "none", "completed"],
	};
	return order[status]
		.map((id) => ({ id, label: GROUP_LABELS[id], tasks: buckets[id] }))
		.filter((group) => group.tasks.length > 0);
}

/** Mirrors the backend rules so the interface only offers actions that will succeed. */
export function getTaskPermissions(
	task: CalendarTaskRecord,
	account: TaskAccount,
): TaskPermissions {
	if (!account) {
		// Listed tasks are always related to the viewer; privileged actions wait for the session.
		return { canEdit: true, canComplete: true, canReassign: false, canDelete: false };
	}
	const isCreator = task.creatorUserId === account.id;
	const isAssignee = task.assigneeUserId === account.id;
	return {
		canEdit: isCreator || isAssignee,
		canComplete: isCreator || isAssignee,
		canReassign: isCreator,
		canDelete: isCreator || account.role === "admin",
	};
}

function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] || name;
}

/** Who else is involved, from the viewer's side: "From Maya" or "For Maya". */
export function getTaskRelationLabel(
	task: CalendarTaskRecord,
	accountId: string | undefined,
	scope: CalendarTaskScope,
): string | null {
	if (task.creatorUserId === task.assigneeUserId) return null;
	if (accountId === task.assigneeUserId) return `From ${firstName(task.creatorName)}`;
	if (accountId === task.creatorUserId) return `For ${firstName(task.assigneeName)}`;
	if (scope === "assigned") return `From ${firstName(task.creatorName)}`;
	if (scope === "created") return `For ${firstName(task.assigneeName)}`;
	return `${firstName(task.creatorName)} → ${firstName(task.assigneeName)}`;
}

export function getPersonLabel(
	userId: string,
	name: string,
	accountId: string | undefined,
): string {
	return userId === accountId ? "You" : name;
}

const ACTIVITY_TEXT: Record<CalendarTaskActivity["action"], string> = {
	created: "created this task",
	updated: "edited the details",
	reassigned: "changed the assignee",
	completed: "marked it complete",
	reopened: "reopened it",
	deleted: "deleted this task",
};

export function describeTaskActivity(
	item: CalendarTaskActivity,
	accountId: string | undefined,
): { actor: string; text: string } {
	const actor =
		item.actorUserId && item.actorUserId === accountId
			? "You"
			: (item.actorName ?? item.actorEmail ?? "A removed account");
	return { actor, text: ACTIVITY_TEXT[item.action] ?? "changed this task" };
}

/** Whether a task belongs in a list query, used to place optimistic changes. */
export function taskMatchesListParams(
	task: CalendarTaskRecord,
	params: CalendarTaskListParams,
	accountId: string,
	now = new Date(),
): boolean {
	const scope = params.scope ?? "assigned";
	if (scope === "assigned" && task.assigneeUserId !== accountId) return false;
	if (scope === "created" && task.creatorUserId !== accountId) return false;
	if (scope === "all" && task.assigneeUserId !== accountId && task.creatorUserId !== accountId) {
		return false;
	}
	const status = params.status ?? "open";
	if (status !== "all" && task.status !== status) return false;
	if (params.overdue && !(task.status === "open" && task.dueAt && new Date(task.dueAt) < now)) {
		return false;
	}
	if (params.start || params.end) {
		if (!task.dueAt) return false;
		const due = new Date(task.dueAt);
		if (params.start && due < new Date(params.start)) return false;
		if (params.end && due >= new Date(params.end)) return false;
	}
	return true;
}

export const OPTIMISTIC_TASK_PREFIX = "optimistic-";

export function isOptimisticTask(task: Pick<CalendarTaskRecord, "id">): boolean {
	return task.id.startsWith(OPTIMISTIC_TASK_PREFIX);
}

export function buildOptimisticTask(
	input: CalendarTaskInput,
	account: { id: string; name: string; email: string },
	assignee: { id: string; name: string; email: string } | undefined,
	now = new Date(),
): CalendarTaskRecord {
	const owner = assignee ?? account;
	const timestamp = now.toISOString();
	return {
		id: `${OPTIMISTIC_TASK_PREFIX}${crypto.randomUUID()}`,
		creatorUserId: account.id,
		creatorName: account.name,
		creatorEmail: account.email,
		assigneeUserId: owner.id,
		assigneeName: owner.name,
		assigneeEmail: owner.email,
		completedByUserId: null,
		assignedAt: timestamp,
		mailboxId: input.mailboxId ?? null,
		title: input.title.trim(),
		description: input.description ?? "",
		dueAt: input.allDay && input.dueAt ? `${input.dueAt}T00:00:00.000Z` : (input.dueAt ?? null),
		timezone: input.timezone ?? "UTC",
		allDay: input.allDay ?? false,
		status: "open",
		priority: input.priority ?? "none",
		completedAt: null,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

export function getEmptyTaskMessage(scope: CalendarTaskScope, status: TaskStatusFilter): string {
	if (status === "overdue") return "Nothing overdue.";
	if (status === "completed") return "No completed tasks yet.";
	if (scope === "created") return "Tasks you create for yourself or others appear here.";
	if (scope === "all") return "No tasks yet. Add one above.";
	return "Nothing assigned to you. Add a task above, or wait for one from a colleague.";
}

export type TaskDueMode = "none" | "date" | "time";

export type TaskFormValues = {
	title: string;
	description: string;
	priority: CalendarPriority;
	assigneeUserId: string;
	dueMode: TaskDueMode;
	/** `YYYY-MM-DD` for all-day tasks. */
	dueDate: string;
	/** `YYYY-MM-DDTHH:mm` wall-clock time in `timezone`. */
	dueTime: string;
	timezone: string;
};

export function getTaskFormValues(
	task: CalendarTaskRecord | null,
	defaults: {
		timezone: string;
		assigneeUserId: string;
		title?: string;
		dueKey?: string;
		now?: Date;
	},
): TaskFormValues {
	const now = defaults.now ?? new Date();
	const nextHalfHour = new Date(now);
	nextHalfHour.setSeconds(0, 0);
	nextHalfHour.setMinutes(nextHalfHour.getMinutes() < 30 ? 30 : 60);
	if (!task) {
		return {
			title: defaults.title ?? "",
			description: "",
			priority: "none",
			assigneeUserId: defaults.assigneeUserId,
			dueMode: defaults.dueKey ? "date" : "none",
			dueDate: defaults.dueKey ?? dateKey(now),
			dueTime: instantToWallClock(nextHalfHour, defaults.timezone),
			timezone: defaults.timezone,
		};
	}
	let dueMode: TaskDueMode = "none";
	if (task.dueAt) dueMode = task.allDay ? "date" : "time";
	return {
		title: task.title,
		description: task.description,
		priority: task.priority,
		assigneeUserId: task.assigneeUserId,
		dueMode,
		dueDate: task.dueAt && task.allDay ? utcDateKey(task.dueAt) : dateKey(now),
		dueTime:
			task.dueAt && !task.allDay
				? instantToWallClock(task.dueAt, task.timezone)
				: instantToWallClock(nextHalfHour, task.timezone),
		timezone: task.timezone,
	};
}

function getDueFields(values: TaskFormValues): Pick<CalendarTaskInput, "dueAt" | "allDay"> {
	if (values.dueMode === "date") {
		if (!values.dueDate) throw new Error("Choose a due date.");
		return { dueAt: values.dueDate, allDay: true };
	}
	if (values.dueMode === "time") {
		if (!values.dueTime) throw new Error("Choose a due date and time.");
		const instant = wallClockToInstant(values.dueTime, values.timezone);
		return { dueAt: toOffsetDateTime(instant, values.timezone), allDay: false };
	}
	return { dueAt: null, allDay: false };
}

/** The body for a new task. Omitting the assignee assigns it to the creator. */
export function buildTaskCreateInput(values: TaskFormValues): CalendarTaskInput {
	const title = values.title.trim();
	if (!title) throw new Error("Add a title for the task.");
	return {
		title,
		description: values.description,
		priority: values.priority,
		timezone: values.timezone,
		...getDueFields(values),
		...(values.assigneeUserId ? { assigneeUserId: values.assigneeUserId } : {}),
	};
}

function dueChanged(values: TaskFormValues, baseline: TaskFormValues): boolean {
	if (values.dueMode !== baseline.dueMode) return true;
	if (values.dueMode === "date") return values.dueDate !== baseline.dueDate;
	if (values.dueMode === "time") {
		return values.dueTime !== baseline.dueTime || values.timezone !== baseline.timezone;
	}
	return false;
}

/** Only the fields the viewer changed, so concurrent edits to other fields are kept. */
export function buildTaskPatch(
	values: TaskFormValues,
	baseline: TaskFormValues,
	canReassign: boolean,
): CalendarTaskPatchInput {
	const patch: CalendarTaskPatchInput = {};
	if (values.title !== baseline.title) {
		const title = values.title.trim();
		if (!title) throw new Error("Add a title for the task.");
		patch.title = title;
	}
	if (values.description !== baseline.description) patch.description = values.description;
	if (values.priority !== baseline.priority) patch.priority = values.priority;
	if (canReassign && values.assigneeUserId !== baseline.assigneeUserId) {
		patch.assigneeUserId = values.assigneeUserId;
	}
	if (dueChanged(values, baseline)) {
		Object.assign(patch, getDueFields(values), { timezone: values.timezone });
	}
	return patch;
}

export function isTaskFormDirty(values: TaskFormValues, baseline: TaskFormValues): boolean {
	return (
		values.title !== baseline.title ||
		values.description !== baseline.description ||
		values.priority !== baseline.priority ||
		values.assigneeUserId !== baseline.assigneeUserId ||
		dueChanged(values, baseline)
	);
}

/** Asks an open calendar page to show a task, e.g. from a notification. */
export const OPEN_TASK_EVENT = "mailflare:open-task";

export function getTaskHref(taskId: string): string {
	return `/calendar?task=${encodeURIComponent(taskId)}`;
}
