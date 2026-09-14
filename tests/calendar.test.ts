import { describe, expect, it } from "vitest";
import { createCalendarInvitation } from "../src/lib/calendar/utils";
import {
	calendarAttendees,
	calendarInstant,
	calendarTimezone,
	rejectCalendarRecurrence,
} from "../src/lib/calendar/validation";

describe("calendar validation", () => {
	it("requires explicit offsets for timed values and date-only values for all-day items", () => {
		expect(
			calendarInstant("2026-11-01T01:30:00-04:00", {
				allDay: false,
				label: "an event start",
			}),
		).toEqual(new Date("2026-11-01T05:30:00.000Z"));
		expect(() =>
			calendarInstant("2026-11-01T01:30:00", {
				allDay: false,
				label: "an event start",
			}),
		).toThrow(/timezone offset/);
		expect(
			calendarInstant("2026-11-01", { allDay: true, label: "an all-day event start" }),
		).toEqual(new Date("2026-11-01T00:00:00.000Z"));
		expect(() =>
			calendarInstant("2026-11-01T00:00:00Z", {
				allDay: true,
				label: "an all-day event start",
			}),
		).toThrow(/YYYY-MM-DD/);
	});

	it("validates IANA timezones and deduplicates attendee addresses", () => {
		expect(calendarTimezone("Africa/Nairobi")).toBe("Africa/Nairobi");
		expect(() => calendarTimezone("Mars/Olympus_Mons")).toThrow(/IANA timezone/);
		expect(calendarAttendees([" Person@Example.com ", "person@example.com"])).toEqual([
			"person@example.com",
		]);
		expect(() => calendarAttendees(["not-an-email"])).toThrow(/Invalid attendee/);
	});

	it("rejects recurrence until exception semantics are implemented", () => {
		expect(() => rejectCalendarRecurrence("FREQ=WEEKLY")).toThrow(/exceptions/);
		expect(() => rejectCalendarRecurrence(null)).not.toThrow();
	});
});

describe("calendar invitation", () => {
	it("uses a stable UID and emits update and cancellation metadata", () => {
		const invitation = new TextDecoder().decode(
			createCalendarInvitation({
				title: "Planning, review",
				description: "Line one\nLine two",
				location: "Room 1",
				startsAt: new Date("2026-09-13T09:00:00Z"),
				endsAt: new Date("2026-09-13T10:00:00Z"),
				uid: "evt_123",
				stamp: new Date("2026-09-12T08:00:00Z"),
				method: "CANCEL",
				status: "CANCELLED",
				sequence: 4,
				organizer: "owner@example.com",
				attendees: ["guest@example.com"],
			}),
		);

		expect(invitation).toContain("METHOD:CANCEL");
		expect(invitation).toContain("UID:evt_123@calibercode.io");
		expect(invitation).toContain("SEQUENCE:4");
		expect(invitation).toContain("STATUS:CANCELLED");
		expect(invitation).toContain("ORGANIZER:mailto:owner@example.com");
		expect(invitation).toContain(
			"ATTENDEE;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:guest@example.com",
		);
	});
});
