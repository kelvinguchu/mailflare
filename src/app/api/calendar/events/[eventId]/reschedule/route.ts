import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { calendarEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import type { CalendarEventRouteParams } from "../types";

type RescheduleResult = { ok: true; when: string } | { ok: false; error: string };

/** The CaliberCode CMS's private AdvisoryScheduleService, bound in production only. */
type AdvisoryScheduleBinding = {
	reschedule(input: {
		bookingId: number;
		startsAt: string;
		endsAt: string;
	}): Promise<RescheduleResult>;
};

/**
 * Moves a paid CaliberCode advisory booking. The CMS owns the booking: it checks the
 * new hours, moves it, updates this calendar entry through CalendarSyncService, and
 * emails the client an updated invite. This route only authorises and forwards.
 */
export async function POST(request: Request, { params }: CalendarEventRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const { eventId } = await params;
	const match = /^cc_advisory_(\d+)$/.exec(eventId);
	if (!match) {
		return NextResponse.json(
			{ error: "Only CaliberCode advisory bookings can be rescheduled here" },
			{ status: 400 },
		);
	}
	const event = await ownedEvent(env, user.id, eventId);
	if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

	const body = (await request.json().catch(() => null)) as {
		startsAt?: unknown;
		endsAt?: unknown;
	} | null;
	const startsAt = instant(body?.startsAt);
	const endsAt = instant(body?.endsAt);
	if (!startsAt || !endsAt || endsAt <= startsAt) {
		return NextResponse.json({ error: "Choose a new start and end time" }, { status: 400 });
	}

	const schedule = (env as CloudflareEnv & { CALIBERCODE_SCHEDULE?: AdvisoryScheduleBinding })
		.CALIBERCODE_SCHEDULE;
	if (!schedule) {
		return NextResponse.json(
			{ error: "Rescheduling CaliberCode bookings is only available in production" },
			{ status: 503 },
		);
	}

	let result: RescheduleResult;
	try {
		result = await schedule.reschedule({
			bookingId: Number(match[1]),
			startsAt: startsAt.toISOString(),
			endsAt: endsAt.toISOString(),
		});
	} catch (error) {
		console.error("CaliberCode reschedule failed", error);
		return NextResponse.json(
			{ error: "CaliberCode could not be reached. Nothing was changed - try again." },
			{ status: 502 },
		);
	}
	if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });

	return NextResponse.json({
		event: (await ownedEvent(env, user.id, eventId)) ?? event,
		when: result.when,
	});
}

async function ownedEvent(env: CloudflareEnv, userId: string, eventId: string) {
	const [event] = await getDb(env)
		.select()
		.from(calendarEvents)
		.where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)))
		.limit(1);
	return event ?? null;
}

function instant(value: unknown): Date | null {
	if (typeof value !== "string") return null;
	const date = new Date(value);
	return Number.isFinite(date.getTime()) ? date : null;
}
