import { and, asc, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, users } from "@/db/schema";
import { listTeamCalendarTasks } from "@/lib/calendar/tasks";
import { CalendarInputError, calendarInstant } from "@/lib/calendar/validation";
import { upcomingOccurrences } from "./projection";

/** Six weeks of month view plus padding, with room to spare. */
const MAX_RANGE_DAYS = 62;
const MAX_EVENTS = 1_000;

export function teamCalendarRange(params: URLSearchParams): { start: Date; end: Date } {
	const start = calendarInstant(params.get("start"), { allDay: false, label: "a range start" });
	const end = calendarInstant(params.get("end"), { allDay: false, label: "a range end" });
	if (!start || !end) throw new CalendarInputError("Choose a calendar range");
	if (end <= start) throw new CalendarInputError("Calendar range end must be after its start");
	if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
		throw new CalendarInputError(`Calendar ranges are limited to ${MAX_RANGE_DAYS} days`);
	}
	return { start, end };
}

/** Every account's events and tasks in a range. Callers must check team inspection access. */
export async function listTeamCalendar(
	env: CloudflareEnv,
	range: { start: Date; end: Date },
	now = new Date(),
) {
	const db = getDb(env);
	const [people, eventRows, taskRows] = await Promise.all([
		db
			.select({
				id: users.id,
				name: users.name,
				email: users.email,
				disabled: users.disabled,
				activationStatus: users.activationStatus,
				archivedAt: users.archivedAt,
			})
			.from(users)
			.orderBy(asc(users.name), asc(users.email))
			.limit(500),
		db
			.select()
			.from(calendarEvents)
			.where(
				and(
					eq(calendarEvents.importCancelled, false),
					lt(calendarEvents.startsAt, range.end),
					gt(calendarEvents.endsAt, range.start),
				),
			)
			.orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id))
			.limit(MAX_EVENTS + 1),
		listTeamCalendarTasks(env, range),
	]);
	const events = eventRows
		.slice(0, MAX_EVENTS)
		.map(({ userId, idempotencyKey: _key, requestHash: _hash, ...event }) => ({
			...event,
			ownerUserId: userId,
		}));
	const tasks = [
		...taskRows.tasks.map((task) => ({ ...task, taskId: task.id, upcoming: false })),
		...[...taskRows.tasks, ...taskRows.repeatingBefore].flatMap((task) =>
			upcomingOccurrences(task, range, now).map((occurrence) => ({
				...task,
				id: `${task.id}:${occurrence.index}`,
				taskId: task.id,
				upcoming: true,
				dueAt: occurrence.dueAt,
				recurrenceIndex: occurrence.index,
			})),
		),
	];
	return {
		people: people.map(({ disabled, activationStatus, archivedAt, ...person }) => ({
			...person,
			active: !disabled && activationStatus === "active" && !archivedAt,
		})),
		events,
		tasks,
		truncated: eventRows.length > MAX_EVENTS || taskRows.truncated,
	};
}
