import type { CSSProperties } from "react";
import type { CalendarEventRecord, CalendarTaskRecord } from "@/lib/calendar/types";
import { eventDayKeys, isMultiDayTimed } from "@/lib/calendar/wall-clock";
import { taskDueKey } from "./calendar-utils";

export type DayItem =
	| { kind: "banner"; event: CalendarEventRecord }
	| { kind: "timed"; event: CalendarEventRecord }
	| { kind: "task"; task: CalendarTaskRecord };

/** How long a timed task looks in the hour grid; tasks only have a due time. */
export const TASK_SLOT_MINUTES = 30;

export function dayItemKey(item: DayItem): string {
	return item.kind === "task" ? `task-${item.task.id}` : `${item.kind}-${item.event.id}`;
}

/**
 * Items per local date for the month grid: banners first, then timed items by start
 * time, then tasks. With `timedTasks`, tasks with a due time sort among the timed
 * events, as on shared calendars where the time is what tells people's items apart.
 */
export function monthDayItems(
	events: CalendarEventRecord[],
	tasks: CalendarTaskRecord[],
	{ timedTasks = false }: { timedTasks?: boolean } = {},
): Map<string, DayItem[]> {
	const byDay = new Map<string, DayItem[]>();
	const push = (key: string, item: DayItem) => {
		const list = byDay.get(key) ?? [];
		list.push(item);
		byDay.set(key, list);
	};
	for (const event of events) {
		const banner = event.allDay || isMultiDayTimed(event);
		for (const key of eventDayKeys(event)) {
			push(key, banner ? { kind: "banner", event } : { kind: "timed", event });
		}
	}
	for (const task of tasks) {
		const key = taskDueKey(task);
		if (key) push(key, { kind: "task", task });
	}
	const rank = (item: DayItem) => {
		if (item.kind === "banner") return 0;
		if (item.kind === "timed") return 1;
		return timedTasks && !item.task.allDay ? 1 : 2;
	};
	const time = (item: DayItem) => {
		if (item.kind !== "task") return Date.parse(item.event.startsAt);
		return timedTasks && item.task.dueAt ? Date.parse(item.task.dueAt) : 0;
	};
	for (const items of byDay.values()) {
		items.sort((a, b) => rank(a) - rank(b) || time(a) - time(b));
	}
	return byDay;
}

/**
 * Splits a day's items into the rows that fit and the rest. When anything is hidden
 * the last row becomes the "+N more" control, so a cell never grows past `rows`.
 */
export function splitDayItems<T>(items: T[], rows: number): { visible: T[]; hidden: T[] } {
	if (items.length <= rows) return { visible: items, hidden: [] };
	const shown = Math.max(rows - 1, 0);
	return { visible: items.slice(0, shown), hidden: items.slice(shown) };
}

/** A timed task as a span for the hour grid, starting at its due time. */
export function taskTimedSpan(
	task: Pick<CalendarTaskRecord, "dueAt">,
): { startsAt: string; endsAt: string } | null {
	if (!task.dueAt) return null;
	const start = Date.parse(task.dueAt);
	return {
		startsAt: new Date(start).toISOString(),
		endsAt: new Date(start + TASK_SLOT_MINUTES * 60_000).toISOString(),
	};
}

/** Light background and accent stripe in an owner's color. */
export function ownerTint(color: string, inset = false): CSSProperties {
	return {
		backgroundColor: `color-mix(in srgb, ${color} 14%, white)`,
		borderColor: `color-mix(in srgb, ${color} 35%, white)`,
		...(inset ? { boxShadow: `inset 3px 0 0 ${color}` } : {}),
	};
}
