import { WorkerEntrypoint } from "cloudflare:workers";

/** Private service-binding API. No public HTTP endpoint or browser credentials. */
export type CaliberCodeCalendarInput = {
	source: "advisory" | "event";
	/** Advisory booking id, or the text id of one of an event's dates. */
	sourceId: number | string;
	title: string;
	description: string;
	location: string;
	startsAt: string;
	endsAt: string;
	active: boolean;
};

/** Must stay in step with the managed-event id checks in the calendar routes and UI. */
function validSourceId(source: unknown, sourceId: unknown): boolean {
	if (source === "advisory") {
		return typeof sourceId === "number" && Number.isSafeInteger(sourceId) && sourceId > 0;
	}
	return typeof sourceId === "string" && /^[a-z0-9]{1,64}$/i.test(sourceId);
}

export class CalendarSyncService extends WorkerEntrypoint<CloudflareEnv> {
	async syncEvent(input: CaliberCodeCalendarInput): Promise<void> {
		if (
		!input ||
		!(["advisory", "event"] as unknown[]).includes(input.source) ||
		!validSourceId(input.source, input.sourceId) ||
		typeof input.title !== "string" ||
		!input.title.trim() ||
		input.title.length > 200 ||
		typeof input.description !== "string" ||
		input.description.length > 10_000 ||
		typeof input.location !== "string" ||
		input.location.length > 500 ||
		typeof input.active !== "boolean"
		) throw new Error("Invalid CaliberCode calendar entry");

		const start = Date.parse(input.startsAt);
		const end = Date.parse(input.endsAt);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
			throw new Error("Invalid CaliberCode calendar time");
		}

		const id = `cc_${input.source}_${input.sourceId}`;
		if (!input.active) {
			await this.env.DB.prepare("DELETE FROM calendar_events WHERE id = ?")
				.bind(id).run();
			return;
		}

		const owner = await this.env.DB.prepare(
			`SELECT id FROM users WHERE lower(email) = 'mohamed@calibercode.io'
			 AND activation_status = 'active' AND disabled = 0 AND archived_at IS NULL LIMIT 1`,
		).first<{ id: string }>();
		if (!owner) throw new Error("Mohamed's active Mailflare account is required for calendar sync");

		const now = Math.floor(Date.now() / 1000);
		await this.env.DB.prepare(
			`INSERT INTO calendar_events
			 (id, user_id, title, description, location, attendees, starts_at, ends_at,
			  timezone, all_day, sequence, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, '[]', ?, ?, 'Africa/Nairobi', 0, 0, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			 title = excluded.title, description = excluded.description,
			 location = excluded.location, starts_at = excluded.starts_at,
			 ends_at = excluded.ends_at, updated_at = excluded.updated_at
			 WHERE calendar_events.user_id = excluded.user_id`,
		).bind(id, owner.id, input.title.trim(), input.description, input.location,
			Math.floor(start / 1000), Math.floor(end / 1000), now, now).run();

		// Mailflare's existing reminder dispatcher delivers this in its native UI.
		const reminderId = `cc_rem_${input.source}_${input.sourceId}_${Math.floor(start / 1000)}`;
		const remindAt = Math.floor((start - 24 * 60 * 60 * 1000) / 1000);
		await this.env.DB.prepare(
			"DELETE FROM calendar_reminders WHERE event_id = ? AND status = 'scheduled' AND id <> ?",
		).bind(id, reminderId).run();
		if (remindAt <= now) {
			await this.env.DB.prepare(
				"DELETE FROM calendar_reminders WHERE event_id = ? AND status = 'scheduled'",
			).bind(id).run();
			return;
		}
		await this.env.DB.prepare(
			`INSERT INTO calendar_reminders
			 (id, user_id, event_id, title, message, channel, remind_at, timezone,
			  status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 'in_app', ?, 'Africa/Nairobi', 'scheduled', ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			 title = excluded.title, message = excluded.message,
			 remind_at = excluded.remind_at, updated_at = excluded.updated_at
			 WHERE calendar_reminders.status = 'scheduled'`,
		).bind(reminderId, owner.id, id, input.title.trim(),
			"CaliberCode appointment or event starts in 24 hours.", remindAt, now, now).run();
	}
}
