import type { CalendarReminderRecord, CalendarTaskRecord } from "@/lib/calendar/types";
import type { TaskChangeNotification } from "@/lib/realtime/types";
import { getTaskChangeToast } from "@/hooks/message-realtime-utils";
import { getTaskDueState } from "@/components/calendar/task-utils";

export const MAX_ACTIVITY_ITEMS = 20;
export const MAX_MENU_TASKS = 5;

export type ActivityItem = {
	id: string;
	taskId: string | null;
	action: TaskChangeNotification["task"]["action"];
	title: string;
	description: string;
	occurredAt: string;
	opens: boolean;
};

export type TaskSummary = {
	overdue: number;
	today: number;
	/** Open tasks ordered for the menu: overdue, today, upcoming, then undated. */
	visible: CalendarTaskRecord[];
	total: number;
};

const DUE_ORDER = { overdue: 0, today: 1, upcoming: 2, none: 3, completed: 4 } as const;

export function summarizeTasks(
	tasks: CalendarTaskRecord[],
	now = new Date(),
	limit = MAX_MENU_TASKS,
): TaskSummary {
	let overdue = 0;
	let today = 0;
	const ranked = tasks
		.filter((task) => task.status === "open")
		.map((task) => {
			const state = getTaskDueState(task, now);
			if (state === "overdue") overdue += 1;
			if (state === "today") today += 1;
			return { task, rank: DUE_ORDER[state] };
		})
		.sort((a, b) => a.rank - b.rank || (a.task.dueAt ?? "").localeCompare(b.task.dueAt ?? "") || 0);
	return {
		overdue,
		today,
		total: ranked.length,
		visible: ranked.slice(0, limit).map((entry) => entry.task),
	};
}

export function inAppReminders(reminders: CalendarReminderRecord[] | undefined) {
	return (reminders ?? []).filter((reminder) => reminder.channel === "in_app");
}

/** Newest first, de-duplicated by event id, capped so the session feed stays small. */
export function addActivityItem(
	items: ActivityItem[],
	event: TaskChangeNotification,
): ActivityItem[] {
	if (items.some((item) => item.id === event.eventId)) return items;
	const { title, description } = getTaskChangeToast(event);
	const item: ActivityItem = {
		id: event.eventId,
		taskId: event.task.id,
		action: event.task.action,
		title,
		description,
		occurredAt: event.occurredAt,
		opens: event.task.action !== "deleted",
	};
	return [item, ...items].slice(0, MAX_ACTIVITY_ITEMS);
}

/** The count shown on the avatar: things that need the person now. */
export function getAttentionCount(summary: TaskSummary, reminders: number, unseen: number): number {
	return summary.overdue + summary.today + reminders + unseen;
}

export function formatRelativeTime(value: string, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
	if (!Number.isFinite(seconds)) return "";
	if (seconds < 60) return "Just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
