import { describe, expect, it } from "vitest";
import {
	isTaskOverdue,
	reminderActions,
	reminderChoices,
	senderOptions,
} from "../src/components/calendar/calendar-utils";
import {
	addDaysToKey,
	eventDayKeys,
	instantToWallClock,
	layoutTimedEvents,
	monthGrid,
	timezoneOffsetMinutes,
	toOffsetDateTime,
	utcDateKey,
	wallClockToInstant,
} from "../src/lib/calendar/wall-clock";
import { calendarInstant } from "../src/lib/calendar/validation";

describe("calendar wall clock", () => {
	it("interprets wall-clock input in the item's timezone and formats API offsets", () => {
		const instant = wallClockToInstant("2026-09-14T09:30", "Africa/Nairobi");
		expect(instant.toISOString()).toBe("2026-09-14T06:30:00.000Z");
		expect(toOffsetDateTime(instant, "Africa/Nairobi")).toBe("2026-09-14T09:30:00+03:00");
		expect(instantToWallClock(instant, "Africa/Nairobi")).toBe("2026-09-14T09:30");
		expect(toOffsetDateTime(instant, "America/St_Johns")).toBe("2026-09-14T04:00:00-02:30");
	});

	it("produces values the API validation accepts as the same instant", () => {
		const instant = wallClockToInstant("2026-11-01T01:30", "America/New_York");
		const formatted = toOffsetDateTime(instant, "America/New_York");
		expect(calendarInstant(formatted, { allDay: false, label: "a start" })).toEqual(instant);
	});

	it("follows daylight-saving offsets on both sides of a transition", () => {
		expect(timezoneOffsetMinutes(new Date("2026-03-07T12:00:00Z"), "America/New_York")).toBe(-300);
		expect(timezoneOffsetMinutes(new Date("2026-03-09T12:00:00Z"), "America/New_York")).toBe(-240);
		expect(wallClockToInstant("2026-03-09T09:00", "America/New_York").toISOString()).toBe(
			"2026-03-09T13:00:00.000Z",
		);
		expect(wallClockToInstant("2026-03-07T09:00", "America/New_York").toISOString()).toBe(
			"2026-03-07T14:00:00.000Z",
		);
	});

	it("reads all-day values by their UTC date with an exclusive end", () => {
		expect(utcDateKey("2026-09-14T00:00:00.000Z")).toBe("2026-09-14");
		expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
		expect(
			eventDayKeys({
				startsAt: "2026-09-14T00:00:00.000Z",
				endsAt: "2026-09-16T00:00:00.000Z",
				allDay: true,
			}),
		).toEqual(["2026-09-14", "2026-09-15"]);
		expect(
			eventDayKeys({
				startsAt: "2026-09-14T00:00:00.000Z",
				endsAt: "2026-09-15T00:00:00.000Z",
				allDay: true,
			}),
		).toEqual(["2026-09-14"]);
	});

	it("builds whole weeks around a month", () => {
		const days = monthGrid(new Date(2026, 8, 14));
		expect(days.length % 7).toBe(0);
		expect(days[0].getDay()).toBe(0);
		expect(days.some((day) => day.getMonth() === 8 && day.getDate() === 1)).toBe(true);
		expect(days.some((day) => day.getMonth() === 8 && day.getDate() === 30)).toBe(true);
	});

	it("places overlapping timed events side by side", () => {
		const day = new Date(2026, 8, 14);
		const at = (hour: number, minute = 0) => new Date(2026, 8, 14, hour, minute).toISOString();
		const layout = layoutTimedEvents(
			[
				{ id: "a", startsAt: at(9), endsAt: at(10) },
				{ id: "b", startsAt: at(9, 30), endsAt: at(11) },
				{ id: "c", startsAt: at(10), endsAt: at(10, 30) },
				{ id: "d", startsAt: at(13), endsAt: at(14) },
			],
			day,
		);
		const byId = Object.fromEntries(layout.map((entry) => [entry.item.id, entry]));
		expect(byId.a).toMatchObject({ startMinute: 540, endMinute: 600, column: 0, columns: 2 });
		expect(byId.b).toMatchObject({ column: 1, columns: 2 });
		expect(byId.c).toMatchObject({ column: 0, columns: 2 });
		expect(byId.d).toMatchObject({ column: 0, columns: 1 });
	});
});

describe("calendar UI rules", () => {
	it("offers only future reminder times relative to the target", () => {
		const choices = reminderChoices(
			{
				kind: "event",
				id: "evt_1",
				title: "Standup",
				timezone: "UTC",
				anchor: { value: "2026-09-14T09:00:00.000Z", allDay: false },
			},
			new Date("2026-09-14T08:40:00.000Z"),
		);
		expect(choices.map((choice) => choice.id)).toEqual(["at-time", "5m", "10m"]);
	});

	it("anchors all-day reminders to 9:00 in the item's timezone", () => {
		const [dayOf] = reminderChoices(
			{
				kind: "task",
				id: "tsk_1",
				title: "File report",
				timezone: "Africa/Nairobi",
				anchor: { value: "2026-09-20T00:00:00.000Z", allDay: true },
			},
			new Date("2026-09-14T00:00:00.000Z"),
		);
		expect(dayOf.at.toISOString()).toBe("2026-09-20T06:00:00.000Z");
	});

	it("never offers edits to cancelled reminders", () => {
		expect(reminderActions({ status: "cancelled" })).toEqual({
			edit: false,
			snooze: false,
			dismiss: false,
			cancel: false,
		});
		expect(reminderActions({ status: "delivered" })).toMatchObject({ dismiss: true, snooze: true });
	});

	it("does not treat a completed task as overdue", () => {
		const now = new Date("2026-09-14T12:00:00.000Z");
		const dueAt = "2026-09-13T08:00:00.000Z";
		expect(isTaskOverdue({ dueAt, allDay: false, status: "open" }, now)).toBe(true);
		expect(isTaskOverdue({ dueAt, allDay: false, status: "completed" }, now)).toBe(false);
	});

	it("excludes read-only mailboxes from sender choices", () => {
		expect(
			senderOptions([
				{ id: "mb_1", localPart: "me", hostname: "example.com", displayName: null },
				{
					id: "mb_2",
					localPart: "team",
					hostname: "example.com",
					displayName: null,
					permission: "read_only",
				},
			]),
		).toEqual([{ key: "mb_1|me@example.com", mailboxId: "mb_1", address: "me@example.com" }]);
	});
});
