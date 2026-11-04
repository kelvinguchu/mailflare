import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentUser: vi.fn(),
	listTeamCalendar: vi.fn(),
	createAuditLog: vi.fn(),
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));

vi.mock("@/lib/auth/cookies", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/cloudflare", () => ({ getEnv: () => ({ DEPLOYMENT_ENV: "local" }) }));
vi.mock("@/lib/mailboxes/audit", () => ({ createAuditLog: mocks.createAuditLog }));
vi.mock("@/lib/team-calendar/service", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/team-calendar/service")>();
	return { ...original, listTeamCalendar: mocks.listTeamCalendar };
});
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/components/team-calendar/team-calendar-view", () => ({
	TeamCalendarView: () => null,
}));

import { GET as listTeamCalendar } from "../src/app/api/team-calendar/route";
import { POST as startSession } from "../src/app/api/team-calendar/session/route";
import TeamCalendarPage from "../src/app/(dashboard)/team-calendar/page";
import {
	dayItemKey,
	monthDayItems,
	splitDayItems,
	taskTimedSpan,
} from "../src/components/calendar/calendar-grid-utils";
import {
	DEFAULT_TEAM_FILTERS,
	PERSON_COLORS,
	filterTeamCalendar,
	legendPeople,
	itemCounts,
	personColors,
} from "../src/components/team-calendar/team-calendar-utils";
import { capTimedColumns, layoutTimedEvents } from "../src/lib/calendar/wall-clock";
import { upcomingOccurrences } from "../src/lib/team-calendar/projection";
import type { TeamCalendarEvent, TeamCalendarTask } from "../src/lib/team-calendar/types";

const owner = {
	id: "usr_owner",
	email: "admin@example.com",
	name: "Mohamed",
	disabled: false,
	activationStatus: "active" as const,
};
const range = "start=2026-10-01T00:00:00.000Z&end=2026-11-01T00:00:00.000Z";
const request = (query = range) => new Request(`http://localhost/api/team-calendar?${query}`);

describe("team calendar access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.listTeamCalendar.mockResolvedValue({
			people: [],
			events: [],
			tasks: [],
			truncated: false,
		});
	});

	it("serves the calendar and audits the session only for the inspection owner", async () => {
		mocks.getCurrentUser.mockResolvedValue(owner);
		const response = await listTeamCalendar(request());
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
		expect(mocks.listTeamCalendar).toHaveBeenCalledWith(expect.anything(), {
			start: new Date("2026-10-01T00:00:00.000Z"),
			end: new Date("2026-11-01T00:00:00.000Z"),
		});
		expect((await startSession(new Request("http://localhost", { method: "POST" }))).status).toBe(
			200,
		);
		expect(mocks.createAuditLog).toHaveBeenCalledWith(expect.anything(), {
			actorUserId: owner.id,
			action: "team_calendar.inspection_started",
		});
	});

	it("refuses signed-out, other, and inactive accounts without reading anything", async () => {
		const cases: Array<[unknown, number]> = [
			[null, 401],
			[{ ...owner, id: "usr_other", email: "employee@example.com" }, 403],
			[{ ...owner, disabled: true }, 403],
			[{ ...owner, activationStatus: "pending" }, 403],
		];
		for (const [user, status] of cases) {
			mocks.getCurrentUser.mockResolvedValue(user);
			expect((await listTeamCalendar(request())).status).toBe(status);
			expect((await startSession(new Request("http://localhost", { method: "POST" }))).status).toBe(
				status,
			);
		}
		expect(mocks.listTeamCalendar).not.toHaveBeenCalled();
		expect(mocks.createAuditLog).not.toHaveBeenCalled();
	});

	it("hides the page from everyone but the inspection owner", async () => {
		mocks.getCurrentUser.mockResolvedValue({ ...owner, email: "employee@example.com" });
		await expect(TeamCalendarPage()).rejects.toThrow("NEXT_NOT_FOUND");
		mocks.getCurrentUser.mockResolvedValue(null);
		await expect(TeamCalendarPage()).rejects.toThrow("NEXT_NOT_FOUND");
		mocks.getCurrentUser.mockResolvedValue(owner);
		await expect(TeamCalendarPage()).resolves.toBeTruthy();
	});

	it("rejects missing, reversed, and oversized ranges", async () => {
		mocks.getCurrentUser.mockResolvedValue(owner);
		for (const query of [
			"",
			"start=2026-10-02T00:00:00Z&end=2026-10-01T00:00:00Z",
			"start=2026-01-01T00:00:00Z&end=2026-06-01T00:00:00Z",
		]) {
			expect((await listTeamCalendar(request(query))).status).toBe(400);
		}
		expect(mocks.listTeamCalendar).not.toHaveBeenCalled();
	});
});

function task(overrides: Partial<TeamCalendarTask> = {}): TeamCalendarTask {
	return {
		id: "tsk_1",
		taskId: "tsk_1",
		upcoming: false,
		creatorUserId: "usr_a",
		creatorName: "Amina",
		creatorEmail: "amina@example.com",
		assigneeUserId: "usr_a",
		assigneeName: "Amina",
		assigneeEmail: "amina@example.com",
		completedByUserId: null,
		assignedAt: null,
		mailboxId: null,
		title: "Task",
		description: "",
		dueAt: "2026-10-22T09:00:00.000Z",
		timezone: "UTC",
		allDay: false,
		status: "open",
		priority: "none",
		completedAt: null,
		...overrides,
	};
}

function event(overrides: Partial<TeamCalendarEvent> = {}): TeamCalendarEvent {
	return {
		id: "evt_1",
		ownerUserId: "usr_a",
		mailboxId: null,
		title: "Event",
		description: "",
		location: "",
		attendees: "[]",
		organizer: null,
		startsAt: "2026-10-22T09:00:00.000Z",
		endsAt: "2026-10-22T10:00:00.000Z",
		timezone: "UTC",
		allDay: false,
		sequence: 0,
		...overrides,
	};
}

describe("team calendar overlap layout", () => {
	const day = new Date(2026, 9, 22);
	const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute).toISOString();
	const span = (id: string, start: string, minutes: number) => ({
		id,
		startsAt: start,
		endsAt: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
	});

	it("puts items from several people in the same slot side by side", () => {
		const layout = layoutTimedEvents(
			[span("amina", at(9), 30), span("brian", at(9), 30), span("chen", at(9, 15), 60)],
			day,
			30,
		);
		const { blocks, overflow } = capTimedColumns(layout, 3);
		expect(overflow).toEqual([]);
		expect(blocks.map((block) => [block.item.id, block.column, block.columns])).toEqual([
			["amina", 0, 3],
			["brian", 1, 3],
			["chen", 2, 3],
		]);
	});

	it("collapses a crowded slot into a +N block in the last column", () => {
		const items = ["a", "b", "c", "d", "e"].map((id) => span(id, at(9), 30));
		const { blocks, overflow } = capTimedColumns(
			layoutTimedEvents([...items, span("later", at(14), 30)], day, 30),
			3,
		);
		expect(blocks.map((block) => [block.item.id, block.column, block.columns])).toEqual([
			["a", 0, 3],
			["b", 1, 3],
			["later", 0, 1],
		]);
		expect(overflow).toEqual([
			{
				items: [items[2], items[3], items[4]],
				startMinute: 540,
				endMinute: 570,
				column: 2,
				columns: 3,
			},
		]);
	});

	it("keeps separate +N blocks for hidden items that don't overlap each other", () => {
		const layout = layoutTimedEvents(
			[
				span("long", at(9), 180),
				span("x1", at(9), 30),
				span("x2", at(9), 30),
				span("y1", at(11), 30),
				span("y2", at(11), 30),
			],
			day,
			30,
		);
		const { blocks, overflow } = capTimedColumns(layout, 2);
		const shown = blocks.map((block) => block.item.id);
		const hidden = overflow.flatMap((group) => group.items.map((item) => item.id));
		expect([...shown, ...hidden].sort()).toEqual(["long", "x1", "x2", "y1", "y2"]);
		expect(overflow.map((group) => [group.startMinute, group.endMinute])).toEqual([
			[540, 570],
			[660, 690],
		]);
		expect(shown).toEqual(["long"]);
		for (const group of overflow) expect(group).toMatchObject({ column: 1, columns: 2 });
	});

	it("leaves uncrowded days and personal calendars untouched", () => {
		const layout = layoutTimedEvents([span("a", at(9), 60), span("b", at(9), 60)], day);
		expect(capTimedColumns(layout, Number.POSITIVE_INFINITY)).toEqual({
			blocks: layout,
			overflow: [],
		});
	});

	it("gives timed tasks a half-hour slot from their due time", () => {
		expect(taskTimedSpan({ dueAt: "2026-10-22T09:00:00.000Z" })).toEqual({
			startsAt: "2026-10-22T09:00:00.000Z",
			endsAt: "2026-10-22T09:30:00.000Z",
		});
		expect(taskTimedSpan({ dueAt: null })).toBeNull();
	});

	it("stacks a crowded month day with a +N more row and every item in order", () => {
		const nine = new Date(2026, 9, 22, 9).toISOString();
		const eight = new Date(2026, 9, 22, 8).toISOString();
		const byDay = monthDayItems(
			[
				event({ id: "evt_late", startsAt: nine, endsAt: new Date(2026, 9, 22, 10).toISOString() }),
				event({
					id: "evt_all_day",
					allDay: true,
					startsAt: "2026-10-22T00:00:00.000Z",
					endsAt: "2026-10-23T00:00:00.000Z",
				}),
			],
			[
				task({ id: "tsk_all_day", allDay: true, dueAt: "2026-10-22T00:00:00.000Z" }),
				task({ id: "tsk_early", dueAt: eight }),
				task({ id: "tsk_nine", assigneeUserId: "usr_b", dueAt: nine }),
			],
			{ timedTasks: true },
		);
		const items = byDay.get("2026-10-22") ?? [];
		expect(items.map(dayItemKey)).toEqual([
			"banner-evt_all_day",
			"task-tsk_early",
			"timed-evt_late",
			"task-tsk_nine",
			"task-tsk_all_day",
		]);
		const { visible, hidden } = splitDayItems(items, 4);
		expect(visible).toHaveLength(3);
		expect(hidden.map(dayItemKey)).toEqual(["task-tsk_nine", "task-tsk_all_day"]);
		expect(splitDayItems(items.slice(0, 4), 4)).toEqual({ visible: items.slice(0, 4), hidden: [] });
	});
});

describe("team calendar people and filters", () => {
	const data = {
		events: [event({ id: "evt_b", ownerUserId: "usr_b", title: "Board review" })],
		tasks: [
			task({ id: "tsk_a", title: "Invoice run", recurrenceRule: "FREQ=WEEKLY;BYDAY=TH" }),
			task({ id: "tsk_b", assigneeUserId: "usr_b", status: "completed", priority: "high" }),
		],
	};

	it("keeps each person's color stable and shows people with items first", () => {
		const people = [
			{ id: "usr_a", name: "Amina", email: "a@example.com", active: true },
			{ id: "usr_c", name: "Chen", email: "c@example.com", active: true },
			{ id: "usr_d", name: "Dana", email: "d@example.com", active: false },
			{ id: "usr_b", name: "Brian", email: "b@example.com", active: false },
		];
		const colors = personColors(people);
		expect(colors.get("usr_a")).toBe(PERSON_COLORS[0]);
		expect(colors.get("usr_b")).toBe(PERSON_COLORS[3]);
		expect(legendPeople(people, itemCounts(data)).map((person) => person.id)).toEqual([
			"usr_a",
			"usr_b",
			"usr_c",
		]);
	});

	it("filters by person, kind, title, and task fields without hiding events", () => {
		const ids = (result: ReturnType<typeof filterTeamCalendar>) => [
			...result.events.map((item) => item.id),
			...result.tasks.map((item) => item.id),
		];
		expect(ids(filterTeamCalendar(data, DEFAULT_TEAM_FILTERS, new Set(["usr_b"])))).toEqual([
			"tsk_a",
		]);
		expect(
			ids(filterTeamCalendar(data, { ...DEFAULT_TEAM_FILTERS, kind: "events" }, new Set())),
		).toEqual(["evt_b"]);
		expect(
			ids(filterTeamCalendar(data, { ...DEFAULT_TEAM_FILTERS, title: "board" }, new Set())),
		).toEqual(["evt_b"]);
		expect(
			ids(filterTeamCalendar(data, { ...DEFAULT_TEAM_FILTERS, repeating: true }, new Set())),
		).toEqual(["evt_b", "tsk_a"]);
		expect(
			ids(
				filterTeamCalendar(
					data,
					{ ...DEFAULT_TEAM_FILTERS, status: "completed", priority: "high" },
					new Set(),
				),
			),
		).toEqual(["evt_b", "tsk_b"]);
		expect(
			ids(
				filterTeamCalendar(
					data,
					{ ...DEFAULT_TEAM_FILTERS, status: "overdue" },
					new Set(),
					new Date("2026-10-23T00:00:00.000Z"),
				),
			),
		).toEqual(["evt_b", "tsk_a"]);
	});
});

describe("upcoming repeats on the team calendar", () => {
	const range = {
		start: new Date("2026-10-01T00:00:00.000Z"),
		end: new Date("2026-11-01T00:00:00.000Z"),
	};

	it("lists later occurrences in the range at the task's wall-clock time", () => {
		const occurrences = upcomingOccurrences(
			{
				dueAt: new Date("2026-10-05T06:00:00.000Z"),
				allDay: false,
				timezone: "Africa/Nairobi",
				status: "open",
				recurrenceRule: "FREQ=WEEKLY;BYDAY=MO",
				recurrenceIndex: 0,
			},
			range,
			new Date("2026-10-01T00:00:00.000Z"),
		);
		expect(occurrences.map((item) => [item.dueAt.toISOString(), item.index])).toEqual([
			["2026-10-12T06:00:00.000Z", 1],
			["2026-10-19T06:00:00.000Z", 2],
			["2026-10-26T06:00:00.000Z", 3],
		]);
	});

	it("starts after now for overdue tasks and stops at COUNT", () => {
		const occurrences = upcomingOccurrences(
			{
				dueAt: new Date("2026-09-20T00:00:00.000Z"),
				allDay: true,
				timezone: "UTC",
				status: "open",
				recurrenceRule: "FREQ=DAILY;COUNT=40",
				recurrenceIndex: 0,
			},
			range,
			new Date("2026-10-27T12:00:00.000Z"),
		);
		// Day 37 (27 Oct) is today, so completing now would create it; COUNT=40 ends on day 39.
		expect(occurrences.map((item) => item.dueAt.toISOString().slice(0, 10))).toEqual([
			"2026-10-27",
			"2026-10-28",
			"2026-10-29",
		]);
	});

	it("adds nothing for completed, one-off, or unreadable tasks", () => {
		const base = {
			dueAt: new Date("2026-10-05T06:00:00.000Z"),
			allDay: false,
			timezone: "UTC",
			status: "open",
			recurrenceRule: "FREQ=DAILY",
		};
		const now = new Date("2026-10-01T00:00:00.000Z");
		expect(upcomingOccurrences({ ...base, status: "completed" }, range, now)).toEqual([]);
		expect(upcomingOccurrences({ ...base, recurrenceRule: null }, range, now)).toEqual([]);
		expect(upcomingOccurrences({ ...base, recurrenceRule: "FREQ=HOURLY" }, range, now)).toEqual([]);
		expect(upcomingOccurrences(base, range, now, 5)).toHaveLength(5);
	});
});
