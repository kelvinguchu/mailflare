import { describe, expect, it } from "vitest";
import {
	completeRecurrence,
	describeRecurrenceRule,
	formatRecurrenceRule,
	nextTaskOccurrence,
	parseRecurrenceRule,
	type TaskOccurrence,
} from "../src/lib/calendar/recurrence";
import { calendarTaskRecurrence } from "../src/lib/calendar/validation";

const LONG_AGO = new Date("2000-01-01T00:00:00Z");

function occurrences(rule: string, first: TaskOccurrence, limit = 6, now = LONG_AGO): string[] {
	const recurrence = parseRecurrenceRule(rule);
	const keys: string[] = [];
	let current: TaskOccurrence | null = first;
	while (current && keys.length < limit) {
		keys.push(current.dueAt.toISOString());
		current = nextTaskOccurrence(recurrence, current, now);
	}
	return keys;
}

function allDay(key: string, index = 0): TaskOccurrence {
	return { dueAt: new Date(`${key}T00:00:00.000Z`), allDay: true, timezone: "UTC", index };
}

const day = (iso: string) => iso.slice(0, 10);

describe("repeat rules", () => {
	it("round-trips the supported RRULE subset in canonical form", () => {
		expect(
			formatRecurrenceRule(parseRecurrenceRule("rrule:freq=weekly;byday=we,mo;interval=2;count=4")),
		).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4");
		expect(formatRecurrenceRule(parseRecurrenceRule("FREQ=MONTHLY;UNTIL=20301231"))).toBe(
			"FREQ=MONTHLY;UNTIL=20301231",
		);
	});

	it("rejects rules it cannot honour", () => {
		expect(() => parseRecurrenceRule("FREQ=HOURLY")).toThrow(/frequency/);
		expect(() => parseRecurrenceRule("FREQ=WEEKLY;BYDAY=1MO")).toThrow(/weekday/);
		expect(() => parseRecurrenceRule("FREQ=DAILY;BYDAY=MO")).toThrow(/weekly/);
		expect(() => parseRecurrenceRule("FREQ=DAILY;BYSETPOS=1")).toThrow(/BYSETPOS/);
		expect(() => parseRecurrenceRule("FREQ=DAILY;COUNT=2;UNTIL=20300101")).toThrow(/not both/);
		expect(() => parseRecurrenceRule("FREQ=DAILY;UNTIL=20300231")).toThrow(/real date/);
		expect(() => parseRecurrenceRule("FREQ=DAILY;INTERVAL=0")).toThrow(/between/);
	});

	it("anchors weekly, monthly, and yearly rules to the due date", () => {
		const due = new Date("2030-01-31T06:00:00.000Z");
		const options = { allDay: false, timezone: "Africa/Nairobi" };
		const complete = (rule: string) =>
			formatRecurrenceRule(completeRecurrence(parseRecurrenceRule(rule), due, options));
		expect(complete("FREQ=WEEKLY")).toBe("FREQ=WEEKLY;BYDAY=TH");
		expect(complete("FREQ=MONTHLY")).toBe("FREQ=MONTHLY;BYMONTHDAY=31");
		expect(complete("FREQ=YEARLY")).toBe("FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=31");
		expect(() => complete("FREQ=DAILY;UNTIL=20300101")).toThrow(/before the task is due/);
	});

	it("requires a due date and reports invalid rules as input errors", () => {
		const due = { dueAt: new Date("2030-01-07T00:00:00Z"), allDay: true, timezone: "UTC" };
		expect(calendarTaskRecurrence("FREQ=WEEKLY", due)).toBe("FREQ=WEEKLY;BYDAY=MO");
		expect(calendarTaskRecurrence(" ", due)).toBeNull();
		expect(() => calendarTaskRecurrence("FREQ=WEEKLY", { ...due, dueAt: null })).toThrow(
			/due date/,
		);
		expect(() => calendarTaskRecurrence("FREQ=SECONDLY", due)).toThrow(
			expect.objectContaining({ name: "CalendarInputError", status: 400 }),
		);
	});

	it("describes rules in plain words", () => {
		expect(describeRecurrenceRule("FREQ=DAILY")).toBe("Every day");
		expect(describeRecurrenceRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("Every weekday");
		expect(describeRecurrenceRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5")).toBe(
			"Every 2 weeks on Mon, Wed, 5 times",
		);
		expect(describeRecurrenceRule("FREQ=MONTHLY;BYMONTHDAY=31;UNTIL=20301231")).toBe(
			"Monthly on day 31, until Dec 31, 2030",
		);
		expect(describeRecurrenceRule("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29")).toBe("Yearly on Feb 29");
		expect(describeRecurrenceRule("garbage")).toBeNull();
		expect(describeRecurrenceRule(null)).toBeNull();
	});
});

describe("next task occurrence", () => {
	it("steps through chosen weekdays every other week", () => {
		expect(
			occurrences("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE", allDay("2030-01-07")).map(day),
		).toEqual(["2030-01-07", "2030-01-09", "2030-01-21", "2030-01-23", "2030-02-04", "2030-02-06"]);
	});

	it("falls on the last day of shorter months without drifting", () => {
		expect(occurrences("FREQ=MONTHLY;BYMONTHDAY=31", allDay("2030-01-31"), 5).map(day)).toEqual([
			"2030-01-31",
			"2030-02-28",
			"2030-03-31",
			"2030-04-30",
			"2030-05-31",
		]);
		expect(
			occurrences("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", allDay("2028-02-29"), 5).map(day),
		).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
	});

	it("keeps the wall-clock time across a daylight-saving change", () => {
		const first: TaskOccurrence = {
			dueAt: new Date("2030-11-01T13:00:00.000Z"),
			allDay: false,
			timezone: "America/New_York",
			index: 0,
		};
		expect(occurrences("FREQ=WEEKLY;BYDAY=FR", first, 2)).toEqual([
			"2030-11-01T13:00:00.000Z",
			"2030-11-08T14:00:00.000Z",
		]);
	});

	it("ends after COUNT occurrences or on the UNTIL date", () => {
		expect(occurrences("FREQ=DAILY;COUNT=3", allDay("2030-01-07"), 10).map(day)).toEqual([
			"2030-01-07",
			"2030-01-08",
			"2030-01-09",
		]);
		expect(
			occurrences("FREQ=WEEKLY;BYDAY=MO;UNTIL=20300121", allDay("2030-01-07"), 10),
		).toHaveLength(3);
	});

	it("skips occurrences already in the past while counting them", () => {
		const now = new Date("2030-01-10T12:00:00Z");
		const recurrence = parseRecurrenceRule("FREQ=DAILY;COUNT=5");
		expect(nextTaskOccurrence(recurrence, allDay("2030-01-07"), now)).toMatchObject({
			dueAt: new Date("2030-01-10T00:00:00.000Z"),
			index: 3,
		});
		const timed: TaskOccurrence = {
			dueAt: new Date("2030-01-07T09:00:00.000Z"),
			allDay: false,
			timezone: "UTC",
			index: 0,
		};
		expect(nextTaskOccurrence(recurrence, timed, now)).toMatchObject({
			dueAt: new Date("2030-01-11T09:00:00.000Z"),
			index: 4,
		});
		expect(nextTaskOccurrence(recurrence, timed, new Date("2030-01-12T00:00:00Z"))).toBeNull();
	});
});
