import {
	completeRecurrence,
	formatRecurrenceRule,
	parseRecurrenceRule,
	RecurrenceRuleError,
	weekdayOf,
	type TaskRecurrence,
	type TaskRecurrenceFrequency,
} from "@/lib/calendar/recurrence";
import { formatDateKey, wallClockToInstant } from "@/lib/calendar/wall-clock";

export type TaskRepeatPreset =
	"none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | "custom";
export type TaskRepeatEnd = "never" | "until" | "count";

export type TaskRepeatValues = {
	preset: TaskRepeatPreset;
	/** Custom rules only. */
	frequency: TaskRecurrenceFrequency;
	interval: number;
	/** 0 = Sunday … 6 = Saturday; custom weekly rules only. */
	weekdays: number[];
	/** Kept from a saved custom rule so a clamped occurrence doesn't shift the series. */
	monthDay: number | null;
	month: number | null;
	end: TaskRepeatEnd;
	/** `YYYY-MM-DD`, inclusive. */
	until: string;
	count: number;
};

/** The due fields a repeat rule is anchored to. */
export type TaskRepeatDue = {
	dueMode: "none" | "date" | "time";
	dueDate: string;
	dueTime: string;
	timezone: string;
};

export const NO_REPEAT: TaskRepeatValues = {
	preset: "none",
	frequency: "weekly",
	interval: 1,
	weekdays: [],
	monthDay: null,
	month: null,
	end: "never",
	until: "",
	count: 10,
};

export const WEEKDAY_OPTIONS = [
	{ value: 1, short: "M", label: "Monday" },
	{ value: 2, short: "T", label: "Tuesday" },
	{ value: 3, short: "W", label: "Wednesday" },
	{ value: 4, short: "T", label: "Thursday" },
	{ value: 5, short: "F", label: "Friday" },
	{ value: 6, short: "S", label: "Saturday" },
	{ value: 0, short: "S", label: "Sunday" },
];

export const REPEAT_FREQUENCY_OPTIONS: Array<{ value: TaskRecurrenceFrequency; label: string }> = [
	{ value: "daily", label: "days" },
	{ value: "weekly", label: "weeks" },
	{ value: "monthly", label: "months" },
	{ value: "yearly", label: "years" },
];

const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

/** `YYYY-MM-DD` the task is due on, in its own timezone, or null without a due date. */
export function repeatDueKey(due: TaskRepeatDue): string | null {
	if (due.dueMode === "date") return due.dueDate || null;
	if (due.dueMode === "time") return due.dueTime.slice(0, 10) || null;
	return null;
}

export function getTaskRepeatValues(
	rule: string | null | undefined,
	due: TaskRepeatDue,
): TaskRepeatValues {
	if (!rule) return NO_REPEAT;
	let recurrence: TaskRecurrence;
	try {
		recurrence = parseRecurrenceRule(rule);
	} catch {
		return NO_REPEAT;
	}
	const end: Pick<TaskRepeatValues, "end" | "until" | "count"> = {
		end: recurrence.count !== null ? "count" : recurrence.until !== null ? "until" : "never",
		until: recurrence.until ?? "",
		count: recurrence.count ?? NO_REPEAT.count,
	};
	const preset = matchPreset(recurrence, repeatDueKey(due));
	if (preset) return { ...NO_REPEAT, ...end, preset };
	return {
		preset: "custom",
		frequency: recurrence.frequency,
		interval: recurrence.interval,
		weekdays: recurrence.weekdays,
		monthDay: recurrence.monthDay,
		month: recurrence.month,
		...end,
	};
}

/** Starts a custom rule from whatever the picker currently shows. */
export function customRepeatFrom(values: TaskRepeatValues, due: TaskRepeatDue): TaskRepeatValues {
	if (values.preset === "custom") return values;
	const key = repeatDueKey(due);
	const weekday = key ? weekdayOf(key) : 1;
	const frequency: Record<TaskRepeatPreset, TaskRecurrenceFrequency> = {
		none: "weekly",
		custom: "weekly",
		daily: "daily",
		weekdays: "weekly",
		weekly: "weekly",
		monthly: "monthly",
		yearly: "yearly",
	};
	return {
		...values,
		preset: "custom",
		frequency: frequency[values.preset],
		interval: 1,
		weekdays: values.preset === "weekdays" ? WEEKDAYS_MON_FRI : [weekday],
		monthDay: null,
		month: null,
	};
}

/**
 * The canonical rule the API stores, or null for no repeat. Presets follow the due
 * date; `keepAnchor` keeps a saved custom rule's month day while the due date is
 * unchanged.
 */
export function buildTaskRecurrenceRule(
	values: TaskRepeatValues,
	due: TaskRepeatDue,
	keepAnchor = true,
): string | null {
	if (values.preset === "none" || due.dueMode === "none") return null;
	const recurrence: TaskRecurrence = {
		...presetRecurrence(values),
		count: null,
		until: null,
	};
	if (values.end === "count") {
		if (!Number.isInteger(values.count) || values.count < 1) {
			throw new Error("Enter how many times the task repeats.");
		}
		recurrence.count = values.count;
	}
	if (values.end === "until") {
		if (!values.until) throw new Error("Choose the date the repeat ends.");
		recurrence.until = values.until;
	}
	if (!keepAnchor) {
		recurrence.monthDay = null;
		recurrence.month = null;
	}
	const allDay = due.dueMode === "date";
	const key = repeatDueKey(due);
	if (!key || (!allDay && !due.dueTime)) throw new Error("Choose a due date before repeating.");
	const dueAt = allDay
		? new Date(`${key}T00:00:00.000Z`)
		: wallClockToInstant(due.dueTime, due.timezone);
	try {
		return formatRecurrenceRule(
			completeRecurrence(recurrence, dueAt, { allDay, timezone: due.timezone }),
		);
	} catch (error) {
		if (error instanceof RecurrenceRuleError) throw new Error(`${error.message}.`);
		throw error;
	}
}

/** Compares what the picker means, ignoring hidden custom fields of a preset. */
export function repeatValuesKey(values: TaskRepeatValues, due: TaskRepeatDue): string {
	if (values.preset === "none" || due.dueMode === "none") return "none";
	const end =
		values.end === "count"
			? `count:${values.count}`
			: values.end === "until"
				? `until:${values.until}`
				: "never";
	if (values.preset !== "custom") return `${values.preset}|${end}`;
	const weekdays = values.frequency === "weekly" ? values.weekdays.join(",") : "";
	return `custom|${values.frequency}|${values.interval}|${weekdays}|${end}`;
}

export function getRepeatPresetOptions(
	due: TaskRepeatDue,
): Array<{ value: TaskRepeatPreset; label: string }> {
	const key = repeatDueKey(due);
	const weekday = key
		? new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
				new Date(`${key}T00:00:00.000Z`),
			)
		: null;
	const day = key ? Number(key.slice(8, 10)) : null;
	return [
		{ value: "none", label: "Doesn’t repeat" },
		{ value: "daily", label: "Every day" },
		{ value: "weekdays", label: "Every weekday (Mon–Fri)" },
		{ value: "weekly", label: weekday ? `Weekly on ${weekday}` : "Weekly" },
		{ value: "monthly", label: day ? `Monthly on day ${day}` : "Monthly" },
		{
			value: "yearly",
			label: key ? `Yearly on ${formatDateKey(key, { month: "long", day: "numeric" })}` : "Yearly",
		},
		{ value: "custom", label: "Custom…" },
	];
}

function presetRecurrence(values: TaskRepeatValues): TaskRecurrence {
	const base = { interval: 1, weekdays: [], monthDay: null, month: null, count: null, until: null };
	switch (values.preset) {
		case "daily":
			return { ...base, frequency: "daily" };
		case "weekdays":
			return { ...base, frequency: "weekly", weekdays: WEEKDAYS_MON_FRI };
		case "weekly":
			return { ...base, frequency: "weekly" };
		case "monthly":
			return { ...base, frequency: "monthly" };
		case "yearly":
			return { ...base, frequency: "yearly" };
		default:
			return {
				...base,
				frequency: values.frequency,
				interval: Math.max(1, Math.trunc(values.interval) || 1),
				weekdays: values.frequency === "weekly" ? values.weekdays : [],
				monthDay:
					values.frequency === "monthly" || values.frequency === "yearly" ? values.monthDay : null,
				month: values.frequency === "yearly" ? values.month : null,
			};
	}
}

function matchPreset(recurrence: TaskRecurrence, dueKey: string | null): TaskRepeatPreset | null {
	if (recurrence.interval !== 1 || !dueKey) return null;
	const [, month, day] = dueKey.split("-").map(Number);
	if (recurrence.frequency === "daily") return "daily";
	if (recurrence.frequency === "weekly") {
		if (recurrence.weekdays.join() === WEEKDAYS_MON_FRI.join()) return "weekdays";
		const single = recurrence.weekdays.length === 1 ? recurrence.weekdays[0] : null;
		return single === weekdayOf(dueKey) ? "weekly" : null;
	}
	if (recurrence.frequency === "monthly") return recurrence.monthDay === day ? "monthly" : null;
	return recurrence.month === month && recurrence.monthDay === day ? "yearly" : null;
}
