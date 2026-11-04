import ICAL from "ical.js";
import {
	CalendarInputError,
	calendarAttendees,
	calendarEmail,
	calendarText,
	calendarTimezone,
	calendarTitle,
} from "./validation";
import { instantToWallClock, wallClockToInstant } from "./wall-clock";

export const MAX_ICS_BYTES = 256 * 1024;
export type IcsMeeting = {
	index: number;
	uid: string;
	organizer: string;
	title: string;
	description: string;
	location: string;
	attendees: string[];
	startsAt: string | null;
	endsAt: string | null;
	timezone: string | null;
	allDay: boolean;
	sequence: number;
	method: string;
	cancelled: boolean;
	requiresTimezone: boolean;
	alarmMinutes: number | null;
	warning: string | null;
};

function text(component: ICAL.Component, name: string): string {
	const value = component.getFirstPropertyValue(name);
	return typeof value === "string" ? value : "";
}
function address(value: string): string {
	return calendarEmail(value.replace(/^mailto:/i, ""), "organizer or attendee address");
}

function meetingTime(
	component: ICAL.Component,
	name: string,
	chosenTimezone?: string,
): { value: string; timezone: string | null; allDay: boolean } | null {
	const property = component.getFirstProperty(name);
	if (!property) return null;
	const time = property.getFirstValue();
	if (!(time instanceof ICAL.Time)) throw new CalendarInputError("Invalid invitation date");
	const value = time.toString();
	const raw = property.toJSON()[3];
	if (typeof raw !== "string" || raw !== value)
		throw new CalendarInputError("Invalid invitation date");
	if (time.isDate) {
		const date = new Date(`${value}T00:00:00Z`);
		if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
			throw new CalendarInputError("Invalid invitation date");
		return { value, timezone: "UTC", allDay: true };
	}
	const tzid = property.getParameter("tzid");
	const timezone = value.endsWith("Z")
		? "UTC"
		: typeof tzid === "string"
			? calendarTimezone(tzid)
			: chosenTimezone
				? calendarTimezone(chosenTimezone)
				: null;
	if (!timezone) return { value, timezone: null, allDay: false };
	if (value.endsWith("Z")) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) throw new CalendarInputError("Invalid invitation date");
		return { value: date.toISOString(), timezone, allDay: false };
	}
	const wall = value.slice(0, 16);
	const instant = wallClockToInstant(wall, timezone);
	if (instantToWallClock(instant, timezone) !== wall)
		throw new CalendarInputError(
			"This invitation uses a nonexistent local time. Request a UTC invitation.",
		);
	// A DST fold has two possible instants: do not silently select one.
	for (const minutes of [-120, -60, -30, 30, 60, 120]) {
		if (instantToWallClock(new Date(instant.getTime() + minutes * 60_000), timezone) === wall)
			throw new CalendarInputError(
				"This invitation uses an ambiguous local time. Request a UTC invitation.",
			);
	}
	instant.setUTCSeconds(time.second);
	return { value: instant.toISOString(), timezone, allDay: false };
}

/** Bounded parsing only. Recurrences/remote resources are never expanded or fetched. */
export function parseCalendarInvitations(content: string, chosenTimezone?: string): IcsMeeting[] {
	if (
		new TextEncoder().encode(content).byteLength > MAX_ICS_BYTES ||
		content.split(/\r?\n/).length > 4000 ||
		(content.match(/^BEGIN:/gim)?.length ?? 0) > 100
	)
		throw new CalendarInputError("Invitation is too large", 413);
	let root: ICAL.Component;
	try {
		root = new ICAL.Component(ICAL.parse(content));
	} catch {
		throw new CalendarInputError("Malformed calendar invitation");
	}
	if (
		root.name !== "vcalendar" ||
		!/^\s*BEGIN:VCALENDAR[\r\n]/i.test(content) ||
		!/END:VCALENDAR\s*$/i.test(content)
	)
		throw new CalendarInputError("Malformed calendar invitation");
	const events = root.getAllSubcomponents("vevent");
	if (!events.length || events.length > 20)
		throw new CalendarInputError("Choose a calendar file with 1–20 events");
	const method = text(root, "method").toUpperCase() || "PUBLISH";
	return events.map((component, index) => {
		const cancelled =
			method === "CANCEL" || text(component, "status").toUpperCase() === "CANCELLED";
		const result: IcsMeeting = {
			index,
			uid: "",
			organizer: "",
			title: text(component, "summary") || "Meeting",
			description: "",
			location: "",
			attendees: [],
			startsAt: null,
			endsAt: null,
			timezone: null,
			allDay: false,
			sequence: 0,
			method,
			cancelled,
			requiresTimezone: false,
			alarmMinutes: null,
			warning: null,
		};
		try {
			if (!["REQUEST", "PUBLISH", "CANCEL"].includes(method))
				throw new CalendarInputError(`Invitation method ${method} is not supported`);
			result.uid = text(component, "uid").trim();
			if (!result.uid || result.uid.length > 512)
				throw new CalendarInputError("Invitation UID is missing or too long");
			const organizer = text(component, "organizer");
			result.organizer = organizer ? address(organizer) : "";
			if ((method === "REQUEST" || cancelled) && !result.organizer)
				throw new CalendarInputError("Invitation organizer is required");
			const sequence = component.getFirstPropertyValue("sequence") ?? 0;
			if (!Number.isSafeInteger(Number(sequence)) || Number(sequence) < 0)
				throw new CalendarInputError("Invalid invitation sequence");
			result.sequence = Number(sequence);
			result.title = calendarTitle(result.title, "meeting title");
			result.description = calendarText(text(component, "description"));
			result.location = calendarText(text(component, "location"), 500);
			result.attendees = calendarAttendees(
				component
					.getAllProperties("attendee")
					.map((property) => address(String(property.getFirstValue()))),
			);
			if (["rrule", "rdate", "exdate", "recurrence-id"].some((name) => component.hasProperty(name)))
				throw new CalendarInputError(
					"Repeating invitations are not supported. Import a single occurrence.",
				);
			const start = meetingTime(component, "dtstart", chosenTimezone);
			const end = meetingTime(component, "dtend", chosenTimezone);
			if (!start && !cancelled) throw new CalendarInputError("Invitation start is missing");
			if (start) {
				result.allDay = start.allDay;
				result.timezone = start.timezone;
				result.startsAt = start.value;
				result.requiresTimezone = !start.timezone || Boolean(end && !end.timezone);
				if (end && end.allDay !== start.allDay)
					throw new CalendarInputError("Invitation start and end have different date types");
				if (end) result.endsAt = end.value;
				else if (start.allDay && !component.hasProperty("duration"))
					result.endsAt = new Date(new Date(`${start.value}T00:00:00Z`).getTime() + 86_400_000)
						.toISOString()
						.slice(0, 10);
				else {
					const duration = component.getFirstPropertyValue("duration");
					if (
						!(duration instanceof ICAL.Duration) ||
						duration.toSeconds() <= 0 ||
						duration.toSeconds() > 366 * 86400 ||
						(start.allDay && duration.toSeconds() % 86400 !== 0)
					)
						throw new CalendarInputError("Invitation end is missing or invalid");
					const endTime = start.allDay
						? new Date(`${start.value}T00:00:00Z`)
						: new Date(start.value.endsWith("Z") ? start.value : `${start.value}Z`);
					endTime.setTime(endTime.getTime() + duration.toSeconds() * 1000);
					result.endsAt = start.allDay
						? endTime.toISOString().slice(0, 10)
						: start.timezone
							? endTime.toISOString()
							: endTime.toISOString().slice(0, 19);
				}
				if (
					!result.requiresTimezone &&
					result.endsAt &&
					new Date(result.endsAt) <= new Date(result.startsAt)
				)
					throw new CalendarInputError("Invitation end must be after its start");
			}
			const alarms = component.getAllSubcomponents("valarm");
			if (alarms.length === 1) {
				const alarm = alarms[0];
				const trigger = alarm.getFirstProperty("trigger");
				const duration = trigger?.getFirstValue();
				if (
					text(alarm, "action").toUpperCase() === "DISPLAY" &&
					duration instanceof ICAL.Duration &&
					trigger?.getParameter("related") !== "END" &&
					!alarm.hasProperty("repeat") &&
					duration.toSeconds() <= 0 &&
					duration.toSeconds() >= -30 * 86400
				)
					result.alarmMinutes = -duration.toSeconds() / 60;
			}
		} catch (error) {
			result.warning = error instanceof Error ? error.message : "Unsupported invitation";
		}
		return result;
	});
}
