import {
	nextTaskOccurrence,
	parseRecurrenceRule,
	type TaskOccurrence,
} from "@/lib/calendar/recurrence";

type RepeatingTask = {
	dueAt: Date | null;
	allDay: boolean;
	timezone: string;
	status: string;
	recurrenceRule?: string | null;
	recurrenceIndex?: number | null;
};

/** A daily task over a six-week month view needs 42; the cap only stops runaway series. */
export const MAX_UPCOMING_PER_TASK = 100;
const MAX_STEPS = 5_000;

/**
 * Later occurrences of an open repeating task that fall in a range. Only the open
 * occurrence is stored; completing it creates the next one, skipping any already in
 * the past, so these start from the first occurrence after both it and `now`.
 */
export function upcomingOccurrences(
	task: RepeatingTask,
	range: { start: Date; end: Date },
	now: Date,
	limit = MAX_UPCOMING_PER_TASK,
): TaskOccurrence[] {
	if (task.status !== "open" || !task.recurrenceRule || !task.dueAt) return [];
	let recurrence;
	try {
		recurrence = parseRecurrenceRule(task.recurrenceRule);
	} catch {
		return [];
	}
	const occurrences: TaskOccurrence[] = [];
	let current: TaskOccurrence | null = nextTaskOccurrence(
		recurrence,
		{
			dueAt: task.dueAt,
			allDay: task.allDay,
			timezone: task.timezone,
			index: task.recurrenceIndex ?? 0,
		},
		now,
	);
	// Bounds the walk to a range far in the future as well as the result.
	for (let step = 0; current && step < MAX_STEPS; step += 1) {
		if (current.dueAt >= range.end || occurrences.length >= limit) break;
		if (current.dueAt >= range.start) occurrences.push(current);
		current = nextTaskOccurrence(recurrence, current, current.dueAt);
	}
	return occurrences;
}
