import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { calendarEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import {
	advisorySchedule,
	blockEventId,
	canManageAdvisory,
	nairobiInstant,
	type BlockResult,
} from "@/lib/calendar/calibercode-schedule";
import { getEnv } from "@/lib/cloudflare";

/**
 * Blocks a whole day (0-24) or whole hours on one date so nobody can book a
 * CaliberCode advisory session then. The CMS stores the block; this route then
 * adds a read-only entry to the calendar so it can be seen and removed. Paid
 * sessions already in that time are kept and returned as `conflicts`.
 */
export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	if (!canManageAdvisory(user)) {
		return NextResponse.json(
			{ error: "Only Mohamed or an admin can block booking time" },
			{ status: 403 },
		);
	}

	const body = (await request.json().catch(() => null)) as {
		date?: unknown;
		startHour?: unknown;
		endHour?: unknown;
	} | null;
	const date = typeof body?.date === "string" ? body.date : "";
	const startHour = body?.startHour;
	const endHour = body?.endHour;
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
		typeof startHour !== "number" ||
		typeof endHour !== "number"
	) {
		return NextResponse.json({ error: "Choose a date and the hours to block" }, { status: 400 });
	}

	const schedule = advisorySchedule(env);
	if (!schedule) {
		return NextResponse.json(
			{ error: "Blocking CaliberCode booking time is only available in production" },
			{ status: 503 },
		);
	}

	let result: BlockResult;
	try {
		result = await schedule.block({ slotDate: date, startHour, endHour });
	} catch (error) {
		console.error("CaliberCode block failed", error);
		return NextResponse.json(
			{ error: "CaliberCode could not be reached. Nothing was changed - try again." },
			{ status: 502 },
		);
	}
	if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

	const wholeDay = startHour === 0 && endHour === 24;
	const id = blockEventId(result.block.id);
	const db = getDb(env);
	try {
		await db.insert(calendarEvents).values({
			id,
			userId: user.id,
			title: wholeDay ? "Bookings blocked (whole day)" : "Bookings blocked",
			description:
				"Nobody can book a CaliberCode advisory session in this time. Remove the block from this entry to open it again.",
			// All-day entries run from UTC midnight to the next, like other all-day events.
			startsAt: wholeDay ? new Date(`${date}T00:00:00.000Z`) : nairobiInstant(date, startHour),
			endsAt: wholeDay
				? new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000)
				: nairobiInstant(date, endHour),
			timezone: "Africa/Nairobi",
			allDay: wholeDay,
		});
	} catch (error) {
		// Without the entry the block could not be seen or removed, so undo it.
		console.error("Calendar entry for CaliberCode block failed", error);
		await schedule.unblock({ blockId: result.block.id }).catch(() => undefined);
		return NextResponse.json(
			{ error: "The block could not be added to the calendar. Nothing was changed - try again." },
			{ status: 500 },
		);
	}

	const [event] = await db
		.select()
		.from(calendarEvents)
		.where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, user.id)))
		.limit(1);
	return NextResponse.json({ event, conflicts: result.conflicts });
}
