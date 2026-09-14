import type { MailboxOption } from "@/components/mailbox-provider";
import type {
	CalendarPriority,
	CalendarReminderRecord,
	CalendarReminderStatus,
	CalendarTaskRecord,
} from "@/lib/calendar/types";
import {
	addDaysToKey,
	addLocalDays,
	dateKey,
	keyToLocalDate,
	startOfLocalDay,
	utcDateKey,
	wallClockToInstant,
} from "@/lib/calendar/wall-clock";
import type { ReminderTarget, SenderOption, TimedChoice } from "./calendar-types";

export const PRIORITY_OPTIONS: Array<{ value: CalendarPriority; label: string }> = [
	{ value: "none", label: "No priority" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
];

export const PRIORITY_STYLES: Record<CalendarPriority, string> = {
	none: "text-neutral-400",
	low: "text-sky-600",
	medium: "text-amber-600",
	high: "text-red-600",
};

export const REMINDER_STATUS_STYLES: Record<
	CalendarReminderStatus,
	{ label: string; className: string }
> = {
	scheduled: { label: "Scheduled", className: "bg-primary/8 text-primary" },
	processing: { label: "Sending", className: "bg-sky-50 text-sky-700" },
	delivered: { label: "Due", className: "bg-amber-50 text-amber-700" },
	dismissed: { label: "Dismissed", className: "bg-neutral-100 text-neutral-600" },
	cancelled: { label: "Cancelled", className: "bg-neutral-100 text-neutral-500" },
	failed: { label: "Failed", className: "bg-red-50 text-red-700" },
};

export const REMINDER_STATUS_FILTERS: Array<{
	value: "due" | CalendarReminderStatus | "all";
	label: string;
}> = [
	{ value: "due", label: "Due now" },
	{ value: "scheduled", label: "Scheduled" },
	{ value: "failed", label: "Failed" },
	{ value: "dismissed", label: "Dismissed" },
	{ value: "cancelled", label: "Cancelled" },
	{ value: "all", label: "All reminders" },
];

/** Mailbox addresses the user may send invitations or email reminders from. */
export function senderOptions(mailboxes: MailboxOption[]): SenderOption[] {
	return mailboxes
		.filter((mailbox) => mailbox.permission !== "read_only")
		.flatMap((mailbox) => {
			const addresses = mailbox.senderAddresses?.length
				? mailbox.senderAddresses
				: [`${mailbox.localPart}@${mailbox.hostname}`];
			return addresses.map((address) => ({
				key: `${mailbox.id}|${address.toLowerCase()}`,
				mailboxId: mailbox.id,
				address: address.toLowerCase(),
			}));
		});
}

export function findSenderOption(
	options: SenderOption[],
	mailboxId: string | null | undefined,
	address: string | null | undefined,
): SenderOption | undefined {
	const normalized = address?.toLowerCase();
	return (
		options.find((option) => option.mailboxId === mailboxId && option.address === normalized) ??
		options.find((option) => option.address === normalized)
	);
}

/** Default start for new items: the next half hour in local time. */
export function nextHalfHour(now = new Date()): Date {
	const date = new Date(now);
	date.setSeconds(0, 0);
	date.setMinutes(date.getMinutes() < 30 ? 30 : 60);
	return date;
}

export function taskDueKey(task: Pick<CalendarTaskRecord, "dueAt" | "allDay">): string | null {
	if (!task.dueAt) return null;
	return task.allDay ? utcDateKey(task.dueAt) : dateKey(new Date(task.dueAt));
}

export function isTaskOverdue(
	task: Pick<CalendarTaskRecord, "dueAt" | "allDay" | "status">,
	now = new Date(),
): boolean {
	if (task.status !== "open" || !task.dueAt) return false;
	return task.allDay ? utcDateKey(task.dueAt) < dateKey(now) : new Date(task.dueAt) < now;
}

export function formatTaskDue(
	task: Pick<CalendarTaskRecord, "dueAt" | "allDay">,
	now = new Date(),
): string | null {
	const key = taskDueKey(task);
	if (!key || !task.dueAt) return null;
	const today = dateKey(now);
	const relative =
		key === today
			? "Today"
			: key === addDaysToKey(today, 1)
				? "Tomorrow"
				: key === addDaysToKey(today, -1)
					? "Yesterday"
					: null;
	const day =
		relative ??
		keyToLocalDate(key).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			year: key.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
		});
	if (task.allDay) return day;
	return `${day}, ${new Date(task.dueAt).toLocaleTimeString(undefined, {
		hour: "numeric",
		minute: "2-digit",
	})}`;
}

/** Quick reminder times relative to the event start or task due date. */
export function reminderChoices(target: ReminderTarget, now = new Date()): TimedChoice[] {
	if (!target.anchor) return [];
	const choices: TimedChoice[] = [];
	if (target.anchor.allDay) {
		const key = utcDateKey(target.anchor.value);
		const at = (offset: number) =>
			wallClockToInstant(`${addDaysToKey(key, offset)}T09:00`, target.timezone);
		choices.push(
			{ id: "day-of", label: "On the day at 9:00 AM", at: at(0) },
			{ id: "day-before", label: "1 day before at 9:00 AM", at: at(-1) },
			{ id: "week-before", label: "1 week before at 9:00 AM", at: at(-7) },
		);
	} else {
		const anchor = new Date(target.anchor.value).getTime();
		const before = (minutes: number) => new Date(anchor - minutes * 60_000);
		const label = target.kind === "event" ? "start" : "due time";
		choices.push(
			{ id: "at-time", label: `At ${label}`, at: before(0) },
			{ id: "5m", label: "5 minutes before", at: before(5) },
			{ id: "10m", label: "10 minutes before", at: before(10) },
			{ id: "30m", label: "30 minutes before", at: before(30) },
			{ id: "1h", label: "1 hour before", at: before(60) },
			{ id: "1d", label: "1 day before", at: before(24 * 60) },
		);
	}
	return choices.filter((choice) => choice.at > now);
}

export function snoozeChoices(now = new Date()): TimedChoice[] {
	const tomorrow = addLocalDays(startOfLocalDay(now), 1);
	tomorrow.setHours(9);
	return [
		{ id: "10m", label: "10 minutes", at: new Date(now.getTime() + 10 * 60_000) },
		{ id: "1h", label: "1 hour", at: new Date(now.getTime() + 60 * 60_000) },
		{ id: "3h", label: "3 hours", at: new Date(now.getTime() + 3 * 60 * 60_000) },
		{ id: "tomorrow", label: "Tomorrow at 9:00 AM", at: tomorrow },
	];
}

/** What the owner can still do with a reminder in its current state. */
export function reminderActions(reminder: Pick<CalendarReminderRecord, "status">) {
	const { status } = reminder;
	return {
		edit: status === "scheduled" || status === "dismissed" || status === "failed",
		snooze: status === "scheduled" || status === "delivered" || status === "failed",
		dismiss: status === "delivered",
		cancel: status === "scheduled" || status === "failed",
	};
}

export function errorMessage(
	error: unknown,
	fallback = "Something went wrong. Try again.",
): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

/** Reminders that have fired and are waiting to be dismissed or snoozed. */
export const DUE_REMINDER_PARAMS = { status: "delivered", due: true } as const;

export type TaskTone = "completed" | "overdue" | "open";

export function getTaskTone(
	task: Pick<CalendarTaskRecord, "dueAt" | "allDay" | "status">,
	now = new Date(),
): TaskTone {
	if (task.status === "completed") return "completed";
	return isTaskOverdue(task, now) ? "overdue" : "open";
}

/** Start for an event created without a pointer position: soon if today, otherwise 9:00 AM. */
export function defaultEventStart(day: Date, now = new Date()): Date {
	if (dateKey(day) === dateKey(now)) return nextHalfHour(now);
	const start = startOfLocalDay(day);
	start.setHours(9);
	return start;
}
