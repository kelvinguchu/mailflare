/**
 * Repeat rules for calendar tasks.
 *
 * Rules are stored as a strict subset of iCalendar RRULE so they stay portable:
 * FREQ (DAILY, WEEKLY, MONTHLY, YEARLY), INTERVAL, BYDAY (weekly only, plain
 * weekdays), BYMONTHDAY (monthly/yearly), BYMONTH (yearly), and either COUNT or
 * a date-only UNTIL. Occurrences keep the task's wall-clock time in its timezone,
 * and a month day the month lacks falls on that month's last day.
 */

import { instantToWallClock, utcDateKey, wallClockToInstant } from "./wall-clock";

export type TaskRecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export type TaskRecurrence = {
	frequency: TaskRecurrenceFrequency;
	interval: number;
	/** 0 = Sunday … 6 = Saturday. Weekly rules only. */
	weekdays: number[];
	monthDay: number | null;
	month: number | null;
	count: number | null;
	/** Last allowed occurrence date, `YYYY-MM-DD`, inclusive. */
	until: string | null;
};

export type TaskOccurrence = {
	dueAt: Date;
	allDay: boolean;
	timezone: string;
	/** Zero-based position in the series. */
	index: number;
};

export class RecurrenceRuleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RecurrenceRuleError";
	}
}

export const MAX_RECURRENCE_INTERVAL = 999;
export const MAX_RECURRENCE_COUNT = 1_000;

const FREQUENCIES: Record<string, TaskRecurrenceFrequency> = {
	DAILY: "daily",
	WEEKLY: "weekly",
	MONTHLY: "monthly",
	YEARLY: "yearly",
};
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
const EVERY_UNIT: Record<TaskRecurrenceFrequency, string> = {
	daily: "Every day",
	weekly: "Weekly",
	monthly: "Monthly",
	yearly: "Yearly",
};
const UNIT_NAMES: Record<TaskRecurrenceFrequency, string> = {
	daily: "days",
	weekly: "weeks",
	monthly: "months",
	yearly: "years",
};
/** Guards against unbounded catch-up loops for long-overdue series. */
const MAX_OCCURRENCE_STEPS = 20_000;

export function parseRecurrenceRule(value: string): TaskRecurrence {
	const rule = value.trim().replace(/^RRULE:/i, "");
	if (!rule) throw new RecurrenceRuleError("Enter a repeat rule");
	if (rule.length > 200) throw new RecurrenceRuleError("Repeat rule is too long");
	const parts = new Map<string, string>();
	for (const part of rule.split(";")) {
		const [rawKey, rawValue, ...rest] = part.split("=");
		const key = rawKey?.trim().toUpperCase();
		const partValue = rawValue?.trim().toUpperCase();
		if (!key || !partValue || rest.length > 0) {
			throw new RecurrenceRuleError("Repeat rule is malformed");
		}
		if (parts.has(key)) throw new RecurrenceRuleError(`Repeat rule repeats ${key}`);
		parts.set(key, partValue);
	}
	for (const key of parts.keys()) {
		if (!["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY", "BYMONTH", "COUNT", "UNTIL"].includes(key)) {
			throw new RecurrenceRuleError(`Repeat rules do not support ${key}`);
		}
	}
	const frequency = FREQUENCIES[parts.get("FREQ") ?? ""];
	if (!frequency) {
		throw new RecurrenceRuleError("Repeat frequency must be daily, weekly, monthly, or yearly");
	}
	const interval = parts.has("INTERVAL")
		? boundedInteger(parts.get("INTERVAL"), 1, MAX_RECURRENCE_INTERVAL, "Repeat interval")
		: 1;
	const weekdays = parts.has("BYDAY") ? parseWeekdays(parts.get("BYDAY")!) : [];
	if (weekdays.length > 0 && frequency !== "weekly") {
		throw new RecurrenceRuleError("Weekdays can only be chosen for weekly repeats");
	}
	const monthDay = parts.has("BYMONTHDAY")
		? boundedInteger(parts.get("BYMONTHDAY"), 1, 31, "Repeat month day")
		: null;
	if (monthDay !== null && frequency !== "monthly" && frequency !== "yearly") {
		throw new RecurrenceRuleError("A month day can only be chosen for monthly or yearly repeats");
	}
	const month = parts.has("BYMONTH")
		? boundedInteger(parts.get("BYMONTH"), 1, 12, "Repeat month")
		: null;
	if (month !== null && frequency !== "yearly") {
		throw new RecurrenceRuleError("A month can only be chosen for yearly repeats");
	}
	if (parts.has("COUNT") && parts.has("UNTIL")) {
		throw new RecurrenceRuleError(
			"A repeat can end on a date or after a number of times, not both",
		);
	}
	const count = parts.has("COUNT")
		? boundedInteger(parts.get("COUNT"), 1, MAX_RECURRENCE_COUNT, "Repeat count")
		: null;
	const until = parts.has("UNTIL") ? parseUntil(parts.get("UNTIL")!) : null;
	return { frequency, interval, weekdays, monthDay, month, count, until };
}

export function formatRecurrenceRule(recurrence: TaskRecurrence): string {
	const parts = [`FREQ=${recurrence.frequency.toUpperCase()}`];
	if (recurrence.interval !== 1) parts.push(`INTERVAL=${recurrence.interval}`);
	if (recurrence.frequency === "weekly" && recurrence.weekdays.length > 0) {
		parts.push(
			`BYDAY=${sortWeekdays(recurrence.weekdays)
				.map((day) => WEEKDAY_CODES[day])
				.join(",")}`,
		);
	}
	if (recurrence.frequency === "yearly" && recurrence.month !== null) {
		parts.push(`BYMONTH=${recurrence.month}`);
	}
	if (
		(recurrence.frequency === "monthly" || recurrence.frequency === "yearly") &&
		recurrence.monthDay !== null
	) {
		parts.push(`BYMONTHDAY=${recurrence.monthDay}`);
	}
	if (recurrence.count !== null) parts.push(`COUNT=${recurrence.count}`);
	else if (recurrence.until !== null) parts.push(`UNTIL=${recurrence.until.replaceAll("-", "")}`);
	return parts.join(";");
}

/**
 * Fills the parts a rule leaves to its start date from the task's due date, so
 * later occurrences never drift (a clamped 30 April must not turn into the 30th).
 */
export function completeRecurrence(
	recurrence: TaskRecurrence,
	dueAt: Date,
	options: { allDay: boolean; timezone: string },
): TaskRecurrence {
	const key = localDateKey(dueAt, options);
	const [, month, day] = splitKey(key);
	const completed = { ...recurrence, weekdays: sortWeekdays(recurrence.weekdays) };
	if (completed.frequency === "weekly" && completed.weekdays.length === 0) {
		completed.weekdays = [weekdayOf(key)];
	}
	if (completed.frequency === "monthly" || completed.frequency === "yearly") {
		completed.monthDay ??= day;
	}
	if (completed.frequency === "yearly") completed.month ??= month;
	if (completed.until !== null && completed.until < key) {
		throw new RecurrenceRuleError("A repeat cannot end before the task is due");
	}
	return completed;
}

/**
 * The first occurrence after `current` that is not already in the past, or null
 * when the series has ended. Missed occurrences still count toward COUNT.
 */
export function nextTaskOccurrence(
	recurrence: TaskRecurrence,
	current: TaskOccurrence,
	now: Date,
): TaskOccurrence | null {
	const { allDay, timezone } = current;
	let key = localDateKey(current.dueAt, current);
	const time = allDay ? "00:00" : instantToWallClock(current.dueAt, timezone).slice(11, 16);
	const todayKey = localDateKey(now, { allDay: false, timezone });
	let index = current.index;
	for (let step = 0; step < MAX_OCCURRENCE_STEPS; step += 1) {
		key = nextDateKey(recurrence, key);
		index += 1;
		if (recurrence.count !== null && index >= recurrence.count) return null;
		if (recurrence.until !== null && key > recurrence.until) return null;
		const dueAt = allDay
			? new Date(`${key}T00:00:00.000Z`)
			: wallClockToInstant(`${key}T${time}`, timezone);
		if (allDay ? key >= todayKey : dueAt > now) return { dueAt, allDay, timezone, index };
	}
	return null;
}

export function describeRecurrence(recurrence: TaskRecurrence): string {
	let text =
		recurrence.interval === 1
			? EVERY_UNIT[recurrence.frequency]
			: `Every ${recurrence.interval} ${UNIT_NAMES[recurrence.frequency]}`;
	if (recurrence.frequency === "weekly") {
		const days = sortWeekdays(recurrence.weekdays);
		if (recurrence.interval === 1 && days.join() === "1,2,3,4,5") text = "Every weekday";
		else if (days.length > 0) {
			text += ` on ${days.map((day) => WEEKDAY_NAMES[day]).join(", ")}`;
		}
	}
	if (recurrence.frequency === "monthly" && recurrence.monthDay !== null) {
		text += ` on day ${recurrence.monthDay}`;
	}
	if (
		recurrence.frequency === "yearly" &&
		recurrence.month !== null &&
		recurrence.monthDay !== null
	) {
		text += ` on ${MONTH_NAMES[recurrence.month - 1]} ${recurrence.monthDay}`;
	}
	if (recurrence.count !== null) {
		text += recurrence.count === 1 ? ", once" : `, ${recurrence.count} times`;
	} else if (recurrence.until !== null) {
		text += `, until ${formatKey(recurrence.until)}`;
	}
	return text;
}

export function describeRecurrenceRule(rule: string | null | undefined): string | null {
	if (!rule) return null;
	try {
		return describeRecurrence(parseRecurrenceRule(rule));
	} catch {
		return null;
	}
}

/** Calendar date of a task due value in the task's own timezone. */
export function localDateKey(
	instant: Date,
	options: { allDay: boolean; timezone: string },
): string {
	return options.allDay
		? utcDateKey(instant)
		: instantToWallClock(instant, options.timezone).slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
	const [year, month, day] = splitKey(key);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nextDateKey(recurrence: TaskRecurrence, key: string): string {
	const [year, month, day] = splitKey(key);
	if (recurrence.frequency === "daily") return shiftDays(key, recurrence.interval);
	if (recurrence.frequency === "weekly") {
		const weekdays = sortWeekdays(
			recurrence.weekdays.length ? recurrence.weekdays : [weekdayOf(key)],
		);
		const position = mondayIndex(weekdayOf(key));
		const later = weekdays.find((weekday) => mondayIndex(weekday) > position);
		if (later !== undefined) return shiftDays(key, mondayIndex(later) - position);
		const nextWeekMonday = shiftDays(key, 7 * recurrence.interval - position);
		return shiftDays(nextWeekMonday, mondayIndex(weekdays[0]!));
	}
	if (recurrence.frequency === "monthly") {
		const months = year * 12 + (month - 1) + recurrence.interval;
		return clampedKey(Math.floor(months / 12), (months % 12) + 1, recurrence.monthDay ?? day);
	}
	return clampedKey(
		year + recurrence.interval,
		recurrence.month ?? month,
		recurrence.monthDay ?? day,
	);
}

function clampedKey(year: number, month: number, day: number): string {
	const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return toKey(year, month, Math.min(day, lastDay));
}

function shiftDays(key: string, days: number): string {
	const [year, month, day] = splitKey(key);
	const date = new Date(Date.UTC(year, month - 1, day + days));
	return toKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** RRULE weeks start on Monday (WKST=MO). */
function mondayIndex(weekday: number): number {
	return (weekday + 6) % 7;
}

function sortWeekdays(weekdays: number[]): number[] {
	return [...new Set(weekdays)].sort((a, b) => mondayIndex(a) - mondayIndex(b));
}

function splitKey(key: string): [number, number, number] {
	const [year, month, day] = key.split("-").map(Number);
	return [year!, month!, day!];
}

function toKey(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatKey(key: string): string {
	const [year, month, day] = splitKey(key);
	return `${MONTH_NAMES[month - 1]} ${day}, ${year}`;
}

function parseWeekdays(value: string): number[] {
	const weekdays = value.split(",").map((code) => {
		const weekday = WEEKDAY_CODES.indexOf(code.trim());
		if (weekday < 0) throw new RecurrenceRuleError(`Unknown repeat weekday ${code}`);
		return weekday;
	});
	return sortWeekdays(weekdays);
}

function parseUntil(value: string): string {
	const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
	if (!match) throw new RecurrenceRuleError("Repeat end date must be a calendar date");
	const [, year, month, day] = match.map(Number);
	const key = toKey(year!, month!, day!);
	if (month! < 1 || month! > 12 || day! < 1 || clampedKey(year!, month!, day!) !== key) {
		throw new RecurrenceRuleError("Repeat end date is not a real date");
	}
	return key;
}

function boundedInteger(
	value: string | undefined,
	min: number,
	max: number,
	label: string,
): number {
	if (!value || !/^\d+$/.test(value))
		throw new RecurrenceRuleError(`${label} must be a whole number`);
	const number = Number(value);
	if (number < min || number > max) {
		throw new RecurrenceRuleError(`${label} must be between ${min} and ${max}`);
	}
	return number;
}
