import { and, eq } from "drizzle-orm";
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
	parseStoredAttendees,
	rejectCalendarRecurrence,
} from "@/lib/calendar/validation";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getEmailAddress } from "@/lib/email/address";
import {
	createScopedIdempotencyKey,
	normalizeIdempotencyKey,
} from "@/lib/email/outbound-idempotency";
import { queueEmail } from "@/lib/email/send";
import type { CalendarEventRouteParams } from "./types";

export async function GET(request: Request, { params }: CalendarEventRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const { eventId } = await params;
		return NextResponse.json({ event: await requireOwnedEvent(env, user.id, eventId) });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function PATCH(request: Request, { params }: CalendarEventRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const idempotencyKey = normalizeIdempotencyKey(request.headers.get("Idempotency-Key"));
		const { eventId } = await params;
		if (/^cc_(advisory_\d+|event_[a-z0-9]+)$/i.test(eventId)) {
			return NextResponse.json({ error: "Managed by CaliberCode" }, { status: 403 });
		}
		const input = (await request.json()) as CalendarEventInput;
		rejectCalendarRecurrence(input.recurrenceRule);
		const existing = await requireOwnedEvent(env, user.id, eventId);
		const allDay = input.allDay ?? existing.allDay;
		const startsAt = requiredDate(input.startsAt, allDay, "an event start");
		const endsAt = requiredDate(input.endsAt, allDay, "an event end");
		if (endsAt <= startsAt) throw new CalendarInputError("Event end must be after its start");
		const attendees = calendarAttendees(input.attendees);
		let mailboxId = input.mailboxId === undefined ? existing.mailboxId : input.mailboxId;
		let organizer = existing.organizer;
		if (attendees.length > 0) {
			const sender = await requireCalendarSender(
				env,
				user,
				mailboxId,
				input.from ?? existing.organizer,
			);
			mailboxId = sender.mailboxId;
			organizer = getEmailAddress(sender.fromAddr).toLowerCase();
		} else {
			await requireCalendarMailboxAccess(env, user, mailboxId);
		}
		const sequence = existing.sequence + 1;
		await getDb(env)
			.update(calendarEvents)
			.set({
				mailboxId,
				title: calendarTitle(input.title, "event title"),
				description: calendarText(input.description),
				location: calendarText(input.location, 500),
				attendees: JSON.stringify(attendees),
				organizer,
				startsAt,
				endsAt,
				timezone: calendarTimezone(input.timezone ?? existing.timezone),
				allDay,
				sequence,
				updatedAt: new Date(),
			})
			.where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, user.id)));
		const event = await requireOwnedEvent(env, user.id, eventId);
		await sendEventUpdate(env, event, attendees, idempotencyKey);
		return NextResponse.json({ event }, { headers: { "Idempotency-Key": idempotencyKey } });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

export async function DELETE(request: Request, { params }: CalendarEventRouteParams) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	try {
		const idempotencyKey = normalizeIdempotencyKey(request.headers.get("Idempotency-Key"));
		const { eventId } = await params;
		if (/^cc_(advisory_\d+|event_[a-z0-9]+)$/i.test(eventId)) {
			return NextResponse.json({ error: "Managed by CaliberCode" }, { status: 403 });
		}
		const event = await requireOwnedEvent(env, user.id, eventId);
		const attendees = parseStoredAttendees(event.attendees);
		if (event.mailboxId && event.organizer && attendees.length > 0) {
			const mailboxId = event.mailboxId;
			const organizer = event.organizer;
			await requireCalendarSender(env, user, mailboxId, organizer);
			const sequence = event.sequence + 1;
			const file = createCalendarInvitation({
				...event,
				uid: event.id,
				method: "CANCEL",
				status: "CANCELLED",
				organizer,
				attendees,
				sequence,
			});
			await Promise.all(
				attendees.map(async (to) =>
					queueEmail(
						env,
						{
							userId: user.id,
							mailboxId,
							from: organizer,
							to,
							subject: `Cancelled: ${event.title}`,
							text: `${event.title} has been cancelled.`,
							attachments: [
								{
									filename: "cancel.ics",
									type: "text/calendar; charset=utf-8",
									content: new Uint8Array(file).buffer,
								},
							],
						},
						{
							idempotencyKey: await createScopedIdempotencyKey(
								"calendar-cancel",
								event.id,
								sequence,
								idempotencyKey,
								to,
							),
						},
					),
				),
			);
		}
		await getDb(env)
			.delete(calendarEvents)
			.where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, user.id)));
		return NextResponse.json({ ok: true }, { headers: { "Idempotency-Key": idempotencyKey } });
	} catch (error) {
		if (error instanceof CalendarInputError) {
			return NextResponse.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
}

async function sendEventUpdate(
	env: CloudflareEnv,
	event: typeof calendarEvents.$inferSelect,
	attendees: string[],
	requestKey: string,
): Promise<void> {
	if (!event.mailboxId || !event.organizer || attendees.length === 0) return;
	const mailboxId = event.mailboxId;
	const organizer = event.organizer;
	const file = createCalendarInvitation({
		...event,
		uid: event.id,
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
					subject: `Updated invitation: ${event.title}`,
					text: event.description || `This event has been updated: ${event.title}.`,
					attachments: [
						{
							filename: "invite.ics",
							type: "text/calendar; charset=utf-8",
							content: new Uint8Array(file).buffer,
						},
					],
				},
				{
					idempotencyKey: await createScopedIdempotencyKey(
						"calendar-update",
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

async function requireOwnedEvent(env: CloudflareEnv, userId: string, eventId: string) {
	const [event] = await getDb(env)
		.select()
		.from(calendarEvents)
		.where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)))
		.limit(1);
	if (!event) throw new CalendarInputError("Event not found", 404);
	return event;
}

function requiredDate(value: string, allDay: boolean, label: string): Date {
	const parsed = calendarInstant(value, { allDay, label });
	if (!parsed) throw new CalendarInputError(`Enter ${label}`);
	return parsed;
}
