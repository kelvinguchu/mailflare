import { and, eq, gt, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { calendarEvents } from "@/db/schema";
import { requireCalendarMailboxAccess, requireCalendarSender } from "@/lib/calendar/access";
import type { CalendarEventInput } from "@/lib/calendar/types";
import { createCalendarInvitation } from "@/lib/calendar/utils";
import {
	CalendarInputError,
	calendarAttendees,
	calendarInstant,
	calendarText,
	calendarTimezone,
	calendarTitle,
	rejectCalendarRecurrence,
} from "@/lib/calendar/validation";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getEmailAddress } from "@/lib/email/address";
import {
	createScopedIdempotencyKey,
	createStoredIdempotencyKey,
	normalizeIdempotencyKey,
} from "@/lib/email/outbound-idempotency";
import { queueEmail } from "@/lib/email/send";
import { newId } from "@/lib/ids";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const url = new URL(request.url);
		const start = rangeDate(url.searchParams.get("start"), new Date(), "a calendar range start");
		const end = rangeDate(
			url.searchParams.get("end"),
			new Date(start.getTime() + 31 * 86_400_000),
			"a calendar range end",
		);
		if (end <= start) throw new CalendarInputError("Calendar range end must be after its start");
		const events = await getDb(env)
			.select()
			.from(calendarEvents)
			.where(
				and(
					eq(calendarEvents.userId, user.id),
					lt(calendarEvents.startsAt, end),
					gt(calendarEvents.endsAt, start),
				),
			)
			.orderBy(calendarEvents.startsAt)
			.limit(500);
		return NextResponse.json({ events });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const idempotencyKey = normalizeIdempotencyKey(request.headers.get("Idempotency-Key"));
		const input = (await request.json()) as CalendarEventInput;
		rejectCalendarRecurrence(input.recurrenceRule);
		const allDay = input.allDay ?? false;
		const startsAt = requiredDate(input.startsAt, allDay, "an event start");
		const endsAt = requiredDate(input.endsAt, allDay, "an event end");
		if (endsAt <= startsAt) throw new CalendarInputError("Event end must be after its start");
		const attendees = calendarAttendees(input.attendees);
		const title = calendarTitle(input.title, "event title");
		const description = calendarText(input.description);
		const location = calendarText(input.location, 500);
		const timezone = calendarTimezone(input.timezone);
		let mailboxId = input.mailboxId ?? null;
		let organizer: string | null = null;
		if (attendees.length > 0) {
			const sender = await requireCalendarSender(env, user, mailboxId, input.from);
			mailboxId = sender.mailboxId;
			organizer = getEmailAddress(sender.fromAddr).toLowerCase();
		} else {
			await requireCalendarMailboxAccess(env, user, mailboxId);
		}
		const storedIdempotencyKey = await createStoredIdempotencyKey(user.id, idempotencyKey);
		const requestHash = await createScopedIdempotencyKey(
			"calendar-event-request",
			title,
			description,
			location,
			attendees.join(","),
			startsAt.toISOString(),
			endsAt.toISOString(),
			timezone,
			String(allDay),
			mailboxId,
			organizer,
		);
		const candidate = {
			id: newId("evt"),
			userId: user.id,
			mailboxId,
			title,
			description,
			location,
			attendees: JSON.stringify(attendees),
			organizer,
			startsAt,
			endsAt,
			timezone,
			allDay,
			sequence: 0,
			idempotencyKey: storedIdempotencyKey,
			requestHash,
		};
		await getDb(env).insert(calendarEvents).values(candidate).onConflictDoNothing();
		const [event] = await getDb(env)
			.select()
			.from(calendarEvents)
			.where(
				and(
					eq(calendarEvents.userId, user.id),
					eq(calendarEvents.idempotencyKey, storedIdempotencyKey),
				),
			)
			.limit(1);
		if (!event) throw new Error("Calendar event was not persisted");
		if (event.requestHash !== requestHash) {
			throw new CalendarInputError(
				"The Idempotency-Key was already used for a different calendar event",
				409,
			);
		}
		await sendEventInvitations(env, event, attendees, idempotencyKey);
		return NextResponse.json(
			{ event },
			{
				status: event.id === candidate.id ? 201 : 200,
				headers: { "Idempotency-Key": idempotencyKey },
			},
		);
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

async function sendEventInvitations(
	env: CloudflareEnv,
	event: typeof calendarEvents.$inferSelect,
	attendees: string[],
	requestKey: string,
): Promise<void> {
	if (!event.mailboxId || !event.organizer || attendees.length === 0) return;
	const mailboxId = event.mailboxId;
	const organizer = event.organizer;
	const calendarFile = createCalendarInvitation({
		...event,
		uid: event.id,
		stamp: event.startsAt,
		organizer,
		attendees,
		sequence: event.sequence,
	});
	await Promise.all(
		attendees.map(async (to) =>
			queueEmail(
				env,
				{
					userId: event.userId,
					mailboxId,
					from: organizer,
					to,
					subject: `Invitation: ${event.title}`,
					text: event.description || `You are invited to ${event.title}.`,
					attachments: [
						{
							filename: "invite.ics",
							type: "text/calendar; charset=utf-8",
							content: new Uint8Array(calendarFile).buffer,
						},
					],
				},
				{
					idempotencyKey: await createScopedIdempotencyKey(
						"calendar-invite",
						event.id,
						event.sequence,
						requestKey,
						to,
					),
				},
			),
		),
	);
}

function rangeDate(value: string | null, fallback: Date, label: string): Date {
	if (!value) return fallback;
	return requiredDate(value, false, label);
}

function requiredDate(value: string, allDay: boolean, label: string): Date {
	const parsed = calendarInstant(value, { allDay, label });
	if (!parsed) throw new CalendarInputError(`Enter ${label}`);
	return parsed;
}
