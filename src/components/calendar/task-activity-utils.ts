import { describeRecurrenceRule } from "@/lib/calendar/recurrence";
import type {
	CalendarPriority,
	CalendarTaskActivity,
	TaskActivityChange,
	TaskActivityDue,
	TaskActivityPerson,
} from "@/lib/calendar/types";
import { addDaysToKey, dateKey, keyToLocalDate } from "@/lib/calendar/wall-clock";

/** Who is reading the history, and how they read dates. */
export type TaskActivityViewer = {
	accountId?: string;
	/** BCP 47 locale; the browser's when omitted. */
	locale?: string;
	/** The viewer's timezone. Times in another zone get its short name. */
	timezone?: string;
	now?: Date;
};

export type TaskActivityDescription = {
	/** "You", the actor's name, or a placeholder for a removed account. */
	actor: string;
	/** The rest of the sentence after the actor, such as "renamed this from …". */
	text: string;
	/** For a save that changed several fields, one line per change, each a full phrase. */
	changes: string[];
};

export type TaskActivityDay = {
	/** Local `YYYY-MM-DD`. */
	key: string;
	label: string;
	items: CalendarTaskActivity[];
};

const PRIORITY_LABELS: Record<CalendarPriority, string> = {
	none: "No priority",
	low: "Low",
	medium: "Medium",
	high: "High",
};

const LEGACY_TEXT: Record<CalendarTaskActivity["action"], string> = {
	created: "created this task",
	updated: "edited the details",
	reassigned: "changed the assignee",
	completed: "marked this complete",
	reopened: "reopened this task",
	deleted: "deleted this task",
};

const quote = (value: string) => `“${value}”`;
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);

function zoneName(instant: Date, timeZone: string, locale: string | undefined): string {
	return (
		new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
			.formatToParts(instant)
			.find((part) => part.type === "timeZoneName")?.value ?? timeZone
	);
}

/**
 * A due date or reminder time as the task shows it: in the task's own timezone, with the
 * zone named when it is not the viewer's. All-day dates are calendar days with no time.
 */
export function formatActivityTime(
	value: TaskActivityDue,
	viewer: TaskActivityViewer = {},
): string {
	const instant = new Date(value.at);
	const timeZone = value.allDay ? "UTC" : value.timezone;
	const year = (date: Date, zone: string | undefined) =>
		new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: zone }).format(date);
	const sameYear = year(instant, timeZone) === year(viewer.now ?? new Date(), viewer.timezone);
	const day = new Intl.DateTimeFormat(viewer.locale, {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
		timeZone,
	}).format(instant);
	if (value.allDay) return day;
	const time = new Intl.DateTimeFormat(viewer.locale, {
		hour: "2-digit",
		minute: "2-digit",
		timeZone,
	}).format(instant);
	const zone =
		viewer.timezone && viewer.timezone !== value.timezone
			? ` ${zoneName(instant, value.timezone, viewer.locale)}`
			: "";
	return `${day}, ${time}${zone}`;
}

function personLabel(
	person: TaskActivityPerson,
	actorUserId: string | null,
	viewer: TaskActivityViewer,
): string {
	const isViewer = !!viewer.accountId && person.id === viewer.accountId;
	if (actorUserId && person.id === actorUserId) return isViewer ? "yourself" : "themselves";
	if (isViewer) return "you";
	return person.name ?? "a removed account";
}

function repeatLabel(rule: string): string | null {
	const description = describeRecurrenceRule(rule);
	return description ? lowerFirst(description) : null;
}

/** One change as a phrase that follows the actor's name, starting in lower case. */
export function describeTaskChange(
	change: TaskActivityChange,
	actorUserId: string | null,
	viewer: TaskActivityViewer = {},
): string {
	switch (change.field) {
		case "title":
			return `renamed this from ${quote(change.from)} to ${quote(change.to)}`;
		case "description":
			if (change.change === "added") return "added notes";
			return change.change === "removed" ? "removed the notes" : "edited the notes";
		case "due": {
			const from = change.from && formatActivityTime(change.from, viewer);
			const to = change.to && formatActivityTime(change.to, viewer);
			if (from && to) return `changed the due date from ${from} to ${to}`;
			if (to) return `set the due date to ${to}`;
			return `cleared the due date (was ${from})`;
		}
		case "priority":
			if (change.from === "none") return `set the priority to ${PRIORITY_LABELS[change.to]}`;
			if (change.to === "none") {
				return `removed the priority (was ${PRIORITY_LABELS[change.from]})`;
			}
			return `changed the priority from ${PRIORITY_LABELS[change.from]} to ${PRIORITY_LABELS[change.to]}`;
		case "assignee": {
			const to = personLabel(change.to, actorUserId, viewer);
			if (!change.from) return `assigned this to ${to}`;
			return `reassigned this from ${personLabel(change.from, actorUserId, viewer)} to ${to}`;
		}
		case "repeat": {
			const from = change.from && repeatLabel(change.from);
			const to = change.to && repeatLabel(change.to);
			if (change.from && change.to) {
				return from && to && from !== to
					? `changed the repeat from ${from} to ${to}`
					: "changed how this repeats";
			}
			if (change.to) return to ? `set this to repeat ${to}` : "set this to repeat";
			return from ? `stopped this task repeating (was ${from})` : "stopped this task repeating";
		}
		case "reminder": {
			const kind = change.channel === "email" ? "an email reminder" : "a reminder";
			const at = (value: string) =>
				formatActivityTime({ at: value, allDay: false, timezone: change.timezone }, viewer);
			if (change.from && change.to) {
				return `moved ${kind} from ${at(change.from)} to ${at(change.to)}`;
			}
			if (change.to) return `added ${kind} for ${at(change.to)}`;
			return `removed ${kind} for ${at(change.from!)}`;
		}
		case "mailbox":
			return "changed the linked mailbox";
	}
}

/**
 * A history entry as a sentence: "Alice changed the due date from 12 Nov, 10:00 to 14 Nov,
 * 09:00". A save that changed several fields is one entry whose `changes` list each one.
 * Entries recorded before changes were stored fall back to a description of the action.
 */
export function describeTaskActivity(
	item: CalendarTaskActivity,
	viewer: TaskActivityViewer = {},
): TaskActivityDescription {
	const actor =
		item.actorUserId && item.actorUserId === viewer.accountId
			? "You"
			: (item.actorName ?? item.actorEmail ?? "A removed account");
	const details = item.details;
	const single = (text: string): TaskActivityDescription => ({ actor, text, changes: [] });

	switch (item.action) {
		case "created": {
			if (details?.nextOccurrence) {
				return single("created this occurrence by completing the previous one");
			}
			const assignee = details?.assignee;
			if (assignee && assignee.id !== item.actorUserId) {
				return single(
					`created this task and assigned it to ${personLabel(assignee, item.actorUserId, viewer)}`,
				);
			}
			return single(LEGACY_TEXT.created);
		}
		case "updated":
		case "reassigned": {
			const changes = (details?.changes ?? []).map((change) =>
				describeTaskChange(change, item.actorUserId, viewer),
			);
			if (changes.length === 0) return single(LEGACY_TEXT[item.action]);
			if (changes.length === 1) return single(changes[0]!);
			return { actor, text: `made ${changes.length} changes`, changes: changes.map(capitalize) };
		}
		case "deleted":
			return single(details?.title ? `deleted ${quote(details.title)}` : LEGACY_TEXT.deleted);
		case "completed":
		case "reopened":
			return single(LEGACY_TEXT[item.action]);
		default:
			return single("changed this task");
	}
}

/**
 * "just now", "5 minutes ago", "3 hours ago", then whole days: "yesterday", "2 days ago",
 * "3 weeks ago". Days count calendar days, so they agree with the day headings.
 */
export function formatRelativeTime(value: string, now: Date, locale?: string): string {
	const instant = new Date(value);
	const seconds = Math.round((now.getTime() - instant.getTime()) / 1_000);
	if (seconds < 45) return "just now";
	const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
	if (seconds < 3_600) return format.format(-Math.max(1, Math.round(seconds / 60)), "minute");
	if (seconds < 86_400) return format.format(-Math.max(1, Math.round(seconds / 3_600)), "hour");
	const days = Math.round(
		(keyToLocalDate(dateKey(now)).getTime() - keyToLocalDate(dateKey(instant)).getTime()) /
			86_400_000,
	);
	if (days < 7) return format.format(-days, "day");
	if (days < 30) return format.format(-Math.round(days / 7), "week");
	if (days < 365) return format.format(-Math.max(1, Math.round(days / 30.44)), "month");
	return format.format(-Math.round(days / 365.25), "year");
}

/** The full date and time, for a hover title. */
export function formatExactTime(value: string, locale?: string, timeZone?: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "full",
		timeStyle: "short",
		timeZone,
	}).format(new Date(value));
}

/** "Today", "Yesterday", or the date, with the year only when it is not this year. */
export function activityDayLabel(key: string, now: Date, locale?: string): string {
	const today = dateKey(now);
	if (key === today) return "Today";
	if (key === addDaysToKey(today, -1)) return "Yesterday";
	return keyToLocalDate(key).toLocaleDateString(locale, {
		weekday: "short",
		day: "numeric",
		month: "short",
		...(key.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
	});
}

/** Entries grouped by the viewer's calendar day, newest first, keeping their order. */
export function groupTaskActivityByDay(
	items: readonly CalendarTaskActivity[],
	now: Date,
	locale?: string,
): TaskActivityDay[] {
	const days: TaskActivityDay[] = [];
	for (const item of items) {
		const key = dateKey(new Date(item.createdAt));
		const last = days.at(-1);
		if (last?.key === key) last.items.push(item);
		else days.push({ key, label: activityDayLabel(key, now, locale), items: [item] });
	}
	return days;
}
