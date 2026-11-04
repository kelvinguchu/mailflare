import { and, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEvents, calendarReminders } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/types";
import { createScopedIdempotencyKey } from "@/lib/email/outbound-idempotency";
import { requireCalendarFeature } from "./access";
import type { IcsMeeting } from "./ical";
import {
	CalendarInputError,
	calendarAttendees,
	calendarInstant,
	calendarText,
	calendarTitle,
} from "./validation";

export type CalendarImportOptions = {
	index?: number;
	timezone?: string;
	confirmed?: boolean;
	expectedSequence?: number | null;
	title?: string;
	description?: string;
	location?: string;
	attendees?: string[];
	addReminder?: boolean;
	messageId?: string;
	attachmentId?: string;
};

export async function findImportedEvent(env: CloudflareEnv, userId: string, meeting: IcsMeeting) {
	const [event] = await getDb(env)
		.select()
		.from(calendarEvents)
		.where(
			and(
				eq(calendarEvents.userId, userId),
				eq(calendarEvents.importUid, meeting.uid),
				eq(calendarEvents.importOrganizer, meeting.organizer),
			),
		)
		.limit(1);
	return event ?? null;
}

/** A deliberate user import, never an automatic scheduling/RSVP action. */
export async function confirmCalendarImport(
	env: CloudflareEnv,
	user: SessionUser,
	meeting: IcsMeeting,
	options: CalendarImportOptions,
	sourceSender: string | null = null,
) {
	requireCalendarFeature(user);
	if (options.confirmed !== true)
		throw new CalendarInputError("Confirm the meeting before adding it");
	if (meeting.warning) throw new CalendarInputError(meeting.warning);
	if (meeting.requiresTimezone) throw new CalendarInputError("Choose the invitation timezone");
	const db = getDb(env);
	const existing = await findImportedEvent(env, user.id, meeting);
	if (existing && meeting.sequence <= existing.sequence)
		return { event: existing, outcome: "unchanged" };
	if (meeting.cancelled && !existing)
		throw new CalendarInputError("No matching imported meeting to cancel", 404);
	if (existing && options.expectedSequence !== existing.sequence)
		throw new CalendarInputError(
			"The meeting changed. Review the invitation again before replacing it.",
			409,
		);
	// Received updates must come from the same declared organizer. A different UID/organizer
	// pair can never target an existing event; explicit user confirmation is still required.
	if (existing && sourceSender !== null && sourceSender !== meeting.organizer)
		throw new CalendarInputError("The sender does not match this meeting's organizer", 403);
	const cancelled = meeting.cancelled;
	const startsAt = cancelled
		? existing!.startsAt
		: calendarInstant(meeting.startsAt, { allDay: meeting.allDay, label: "an event start" });
	const endsAt = cancelled
		? existing!.endsAt
		: calendarInstant(meeting.endsAt, { allDay: meeting.allDay, label: "an event end" });
	if (!startsAt || !endsAt || endsAt <= startsAt)
		throw new CalendarInputError("Meeting end must be after its start");
	const identity = await createScopedIdempotencyKey(
		"calendar-import",
		user.id,
		meeting.uid,
		meeting.organizer,
	);
	const values = {
		id: `ics_${identity}`,
		userId: user.id,
		mailboxId: null,
		organizer: null,
		importUid: meeting.uid,
		importOrganizer: meeting.organizer,
		importCancelled: cancelled,
		sequence: meeting.sequence,
		title: calendarTitle(options.title ?? meeting.title, "meeting title"),
		description: calendarText(options.description ?? meeting.description),
		location: calendarText(options.location ?? meeting.location, 500),
		attendees: JSON.stringify(calendarAttendees(options.attendees ?? meeting.attendees)),
		startsAt,
		endsAt,
		timezone: cancelled ? existing!.timezone : (meeting.timezone ?? "UTC"),
		allDay: cancelled ? existing!.allDay : meeting.allDay,
		updatedAt: new Date(),
	};
	// SQLite upsert/CAS settles simultaneous confirmations without duplicates or stale updates.
	await db
		.insert(calendarEvents)
		.values(values)
		.onConflictDoUpdate({
			target: [calendarEvents.userId, calendarEvents.importUid, calendarEvents.importOrganizer],
			set: values,
			setWhere: and(
				lt(calendarEvents.sequence, meeting.sequence),
				eq(calendarEvents.sequence, options.expectedSequence ?? -1),
			),
		});
	const event = await findImportedEvent(env, user.id, meeting);
	if (!event) throw new Error("Calendar import was not persisted");
	if (event.sequence !== meeting.sequence)
		throw new CalendarInputError("The meeting changed. Review it again.", 409);
	const reminderKey = await createScopedIdempotencyKey(
		"calendar-import-reminder",
		event.id,
		event.sequence,
	);
	if (existing || cancelled) {
		await db
			.update(calendarReminders)
			.set({ status: "cancelled", updatedAt: new Date() })
			.where(
				and(
					eq(calendarReminders.eventId, event.id),
					eq(calendarReminders.userId, user.id),
					sql`(${cancelled ? 1 : 0} OR ${calendarReminders.id} != ${`rem_${reminderKey}`})`,
					sql`EXISTS (SELECT 1 FROM calendar_events WHERE id = ${event.id} AND sequence = ${meeting.sequence})`,
				),
			);
	}
	if (options.addReminder && !cancelled && meeting.alarmMinutes !== null) {
		const remindAt = new Date(startsAt.getTime() - meeting.alarmMinutes * 60_000);
		await env.DB.prepare(
			`INSERT INTO calendar_reminders (id,user_id,event_id,title,remind_at,timezone,channel,created_at,updated_at) SELECT ?,?,?,?,?,?,'in_app',unixepoch(),unixepoch() WHERE EXISTS (SELECT 1 FROM calendar_events WHERE id = ? AND sequence = ? AND import_cancelled = 0) ON CONFLICT(id) DO NOTHING`,
		)
			.bind(
				`rem_${reminderKey}`,
				user.id,
				event.id,
				event.title,
				Math.floor(remindAt.getTime() / 1000),
				event.timezone,
				event.id,
				meeting.sequence,
			)
			.run();
	}
	return { event, outcome: cancelled ? "cancelled" : existing ? "updated" : "created" };
}
