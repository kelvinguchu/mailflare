import { describe, expect, it } from "vitest";
import { parseCalendarInvitations } from "@/lib/calendar/ical";

function invitation(lines: string[], method = "REQUEST") {
	return [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		`METHOD:${method}`,
		"BEGIN:VEVENT",
		"UID:meeting-1",
		"ORGANIZER:mailto:host@example.test",
		"SUMMARY:Team review",
		...lines,
		"END:VEVENT",
		"END:VCALENDAR",
		"",
	].join("\r\n");
}

describe("bounded iCalendar import", () => {
	it("keeps UTC instants, folding, attendees, sequence and supported alarms", () => {
		const [meeting] = parseCalendarInvitations(
			invitation([
				"DTSTART:20261009T090000Z",
				"DTEND:20261009T100000Z",
				"SEQUENCE:3",
				"ATTENDEE;CN=Colleague:mailto:person@example.test",
				"DESCRIPTION:First line\\nsecond",
				"LOCATION:Meeting room",
				"SUMMARY:A folded",
				"  title",
				"BEGIN:VALARM",
				"ACTION:DISPLAY",
				"TRIGGER:-PT15M",
				"DESCRIPTION:Reminder",
				"END:VALARM",
			]),
		);
		expect(meeting).toMatchObject({
			startsAt: "2026-10-09T09:00:00.000Z",
			endsAt: "2026-10-09T10:00:00.000Z",
			timezone: "UTC",
			sequence: 3,
			attendees: ["person@example.test"],
			description: "First line\nsecond",
			alarmMinutes: 15,
			warning: null,
		});
	});
	it("converts IANA times, preserves all-day exclusive ends, and requests floating timezone", () => {
		expect(
			parseCalendarInvitations(
				invitation([
					"DTSTART;TZID=Africa/Nairobi:20261009T090000",
					"DTEND;TZID=Africa/Nairobi:20261009T100000",
				]),
			)[0],
		).toMatchObject({
			startsAt: "2026-10-09T06:00:00.000Z",
			timezone: "Africa/Nairobi",
			warning: null,
		});
		expect(
			parseCalendarInvitations(
				invitation(["DTSTART;VALUE=DATE:20261009", "DTEND;VALUE=DATE:20261011"]),
			)[0],
		).toMatchObject({ startsAt: "2026-10-09", endsAt: "2026-10-11", allDay: true, warning: null });
		const floating = invitation(["DTSTART:20261009T090000", "DTEND:20261009T100000"]);
		expect(parseCalendarInvitations(floating)[0]).toMatchObject({
			requiresTimezone: true,
			timezone: null,
		});
		expect(parseCalendarInvitations(floating, "Africa/Nairobi")[0]).toMatchObject({
			startsAt: "2026-10-09T06:00:00.000Z",
			requiresTimezone: false,
		});
	});
	it("selects multiple events and rejects recurrence, malformed, oversized and DST ambiguity", () => {
		const one = invitation(["DTSTART:20261009T090000Z", "DTEND:20261009T100000Z"]);
		const two = one.replace(
			"END:VCALENDAR",
			"BEGIN:VEVENT\r\nUID:meeting-2\r\nDTSTART:20261010T090000Z\r\nDTEND:20261010T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR",
		);
		expect(parseCalendarInvitations(two).map((meeting) => meeting.uid)).toEqual([
			"meeting-1",
			"meeting-2",
		]);
		expect(
			parseCalendarInvitations(one.replace("END:VEVENT", "RRULE:FREQ=DAILY\r\nEND:VEVENT"))[0]
				.warning,
		).toContain("Repeating");
		expect(() => parseCalendarInvitations("not a calendar")).toThrow("Malformed");
		expect(() => parseCalendarInvitations("x".repeat(262145))).toThrow("too large");
		expect(
			parseCalendarInvitations(
				invitation([
					"DTSTART;TZID=America/New_York:20261101T013000",
					"DTEND;TZID=America/New_York:20261101T023000",
				]),
			)[0].warning,
		).toContain("ambiguous");
		expect(
			parseCalendarInvitations(
				invitation([
					"DTSTART;TZID=America/New_York:20260308T023000",
					"DTEND;TZID=America/New_York:20260308T033000",
				]),
			)[0].warning,
		).toContain("nonexistent");
	});
	it("reads date-less cancellations without treating replies as new events", () => {
		expect(parseCalendarInvitations(invitation(["SEQUENCE:4"], "CANCEL"))[0]).toMatchObject({
			cancelled: true,
			sequence: 4,
			warning: null,
		});
		expect(parseCalendarInvitations(invitation([], "REPLY"))[0].warning).toContain("not supported");
	});
});
