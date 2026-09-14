import type { CalendarPriority, CalendarReminderChannel } from "./types";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OFFSET_DATE_TIME_PATTERN = /(?:Z|[+-]\d{2}:\d{2})$/i;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export class CalendarInputError extends Error {
	readonly status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "CalendarInputError";
		this.status = status;
	}
}

export function calendarTitle(value: string | undefined, label = "title"): string {
	const title = value?.trim() ?? "";
	if (!title) throw new CalendarInputError(`Enter a ${label}`);
	if (title.length > 200) throw new CalendarInputError(`${capitalize(label)} is too long`);
	return title;
}

export function calendarText(value: string | null | undefined, maxLength = 10_000): string {
	const text = value?.trim() ?? "";
	if (text.length > maxLength) throw new CalendarInputError("Calendar text is too long");
	return text;
}

export function calendarTimezone(value: string | null | undefined): string {
	const timezone = value?.trim() || "UTC";
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
	} catch {
		throw new CalendarInputError("Enter a valid IANA timezone");
	}
	return timezone;
}

export function calendarInstant(
	value: string | null | undefined,
	options: { allDay: boolean; label: string; optional?: boolean },
): Date | null {
	if (!value) {
		if (options.optional) return null;
		throw new CalendarInputError(`Enter ${options.label}`);
	}
	if (options.allDay ? !DATE_ONLY_PATTERN.test(value) : !OFFSET_DATE_TIME_PATTERN.test(value)) {
		throw new CalendarInputError(
			options.allDay
				? `${capitalize(options.label)} must be a calendar date in YYYY-MM-DD format`
				: `${capitalize(options.label)} must include a UTC or numeric timezone offset`,
		);
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) throw new CalendarInputError(`Enter valid ${options.label}`);
	return date;
}

export function calendarAttendees(values: string[] | undefined): string[] {
	const attendees = new Set<string>();
	for (const value of values ?? []) {
		const email = value.trim().toLowerCase();
		if (!email) continue;
		if (!EMAIL_PATTERN.test(email))
			throw new CalendarInputError(`Invalid attendee email: ${email}`);
		attendees.add(email);
	}
	if (attendees.size > 100) throw new CalendarInputError("An event can have at most 100 attendees");
	return [...attendees];
}

export function calendarEmail(value: string | null | undefined, label: string): string {
	const email = value?.trim().toLowerCase() ?? "";
	if (!EMAIL_PATTERN.test(email)) throw new CalendarInputError(`Enter a valid ${label}`);
	return email;
}

export function calendarPriority(value: string | undefined): CalendarPriority {
	if (!value) return "none";
	if (value === "none" || value === "low" || value === "medium" || value === "high") {
		return value;
	}
	throw new CalendarInputError("Priority must be none, low, medium, or high");
}

export function calendarReminderChannel(value: string | undefined): CalendarReminderChannel {
	if (!value || value === "in_app") return "in_app";
	if (value === "email") return "email";
	throw new CalendarInputError("Reminder channel must be in_app or email");
}

export function rejectCalendarRecurrence(value: string | null | undefined): void {
	if (value?.trim()) {
		throw new CalendarInputError(
			"Repeating calendar items are not enabled until recurrence exceptions are supported",
		);
	}
}

export function calendarErrorMessage(error: Error): string {
	return error.message.slice(0, 500);
}

export function parseStoredAttendees(value: string): string[] {
	try {
		const attendees = JSON.parse(value) as string[];
		return Array.isArray(attendees) ? calendarAttendees(attendees) : [];
	} catch {
		return [];
	}
}

function capitalize(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}
