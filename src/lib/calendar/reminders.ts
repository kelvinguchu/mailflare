import { and, asc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
	calendarEvents,
	calendarReminderDeliveries,
	calendarReminders,
	calendarTasks,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/types";
import { createScopedIdempotencyKey } from "@/lib/email/outbound-idempotency";
import { queueEmail } from "@/lib/email/send";
import { newId } from "@/lib/ids";
import { requireCalendarMailboxAccess, requireCalendarSender } from "./access";
import type {
	CalendarReminderInput,
	CalendarReminderPatchInput,
	CalendarReminderStatus,
} from "./types";
import {
	CalendarInputError,
	calendarEmail,
	calendarErrorMessage,
	calendarInstant,
	calendarReminderChannel,
	calendarText,
	calendarTimezone,
	calendarTitle,
} from "./validation";

const REMINDER_BATCH_LIMIT = 50;
const REMINDER_CLAIM_TIMEOUT_SECONDS = 5 * 60;
const MAX_REMINDER_ATTEMPTS = 5;

export type CalendarReminderFilters = {
	status: CalendarReminderStatus | "all";
	due: boolean;
	eventId?: string;
	taskId?: string;
	start: Date | null;
	end: Date | null;
	now?: Date;
};

type DueReminderRow = {
	id: string;
	user_id: string;
	mailbox_id: string | null;
	title: string;
	message: string;
	channel: "in_app" | "email";
	recipient: string | null;
	from_addr: string | null;
	remind_at: number;
	snoozed_until: number | null;
	attempt_count: number;
};

export async function listCalendarReminders(
	env: CloudflareEnv,
	userId: string,
	filters: CalendarReminderFilters,
) {
	const now = filters.now ?? new Date();
	return getDb(env)
		.select()
		.from(calendarReminders)
		.where(
			and(
				eq(calendarReminders.userId, userId),
				filters.status === "all" ? undefined : eq(calendarReminders.status, filters.status),
				filters.due
					? and(
							inArray(calendarReminders.status, ["scheduled", "processing", "delivered"]),
							lte(calendarReminders.remindAt, now),
						)
					: undefined,
				filters.eventId ? eq(calendarReminders.eventId, filters.eventId) : undefined,
				filters.taskId ? eq(calendarReminders.taskId, filters.taskId) : undefined,
				filters.start ? gte(calendarReminders.remindAt, filters.start) : undefined,
				filters.end ? lt(calendarReminders.remindAt, filters.end) : undefined,
			),
		)
		.orderBy(asc(calendarReminders.remindAt))
		.limit(200);
}

export async function createCalendarReminder(
	env: CloudflareEnv,
	user: SessionUser,
	input: CalendarReminderInput,
) {
	const target = await requireReminderTarget(env, user, input.eventId, input.taskId);
	const channel = calendarReminderChannel(input.channel);
	const timezone = calendarTimezone(input.timezone ?? target.timezone);
	const remindAt = calendarInstant(input.remindAt, {
		allDay: false,
		label: "a reminder time",
	});
	if (!remindAt) throw new CalendarInputError("Enter a reminder time");
	const delivery = await calendarReminderDeliveryFields(env, user, channel, input);
	const reminder = {
		id: newId("rem"),
		userId: user.id,
		eventId: target.kind === "event" ? target.id : null,
		taskId: target.kind === "task" ? target.id : null,
		mailboxId: delivery.mailboxId,
		title: calendarTitle(input.title ?? target.title, "reminder title"),
		message: calendarText(input.message, 5_000),
		channel,
		recipient: delivery.recipient,
		fromAddr: delivery.fromAddr,
		remindAt,
		timezone,
	};
	await getDb(env).insert(calendarReminders).values(reminder);
	return reminder;
}

export async function updateCalendarReminder(
	env: CloudflareEnv,
	user: SessionUser,
	reminderId: string,
	input: CalendarReminderPatchInput,
) {
	const existing = await requireOwnedReminder(env, user.id, reminderId);
	if (existing.status === "processing") {
		throw new CalendarInputError("A reminder being delivered cannot be changed", 409);
	}
	if (existing.status === "cancelled") {
		throw new CalendarInputError("A cancelled reminder cannot be changed; add a new one", 409);
	}
	await requireOpenReminderTask(env, existing.taskId);
	const channel = calendarReminderChannel(input.channel ?? existing.channel);
	const delivery = await calendarReminderDeliveryFields(env, user, channel, {
		mailboxId: input.mailboxId === undefined ? existing.mailboxId : input.mailboxId,
		from: input.from === undefined ? existing.fromAddr : input.from,
		recipient: input.recipient === undefined ? existing.recipient : input.recipient,
	});
	let remindAt = existing.remindAt;
	if (input.remindAt !== undefined) {
		const parsed = calendarInstant(input.remindAt, {
			allDay: false,
			label: "a reminder time",
		});
		if (!parsed) throw new CalendarInputError("Enter a reminder time");
		remindAt = parsed;
	}
	await getDb(env)
		.update(calendarReminders)
		.set({
			title:
				input.title === undefined ? existing.title : calendarTitle(input.title, "reminder title"),
			message: input.message === undefined ? existing.message : calendarText(input.message, 5_000),
			channel,
			mailboxId: delivery.mailboxId,
			recipient: delivery.recipient,
			fromAddr: delivery.fromAddr,
			remindAt,
			timezone: input.timezone === undefined ? existing.timezone : calendarTimezone(input.timezone),
			status: "scheduled",
			snoozedUntil: null,
			claimedAt: null,
			deliveredAt: null,
			dismissedAt: null,
			attemptCount: 0,
			lastError: null,
			updatedAt: new Date(),
		})
		.where(and(eq(calendarReminders.id, reminderId), eq(calendarReminders.userId, user.id)));
	return requireOwnedReminder(env, user.id, reminderId);
}

export async function cancelCalendarReminder(
	env: CloudflareEnv,
	userId: string,
	reminderId: string,
) {
	await requireOwnedReminder(env, userId, reminderId);
	await getDb(env)
		.update(calendarReminders)
		.set({ status: "cancelled", claimedAt: null, updatedAt: new Date() })
		.where(and(eq(calendarReminders.id, reminderId), eq(calendarReminders.userId, userId)));
	return requireOwnedReminder(env, userId, reminderId);
}

export async function dismissCalendarReminder(
	env: CloudflareEnv,
	userId: string,
	reminderId: string,
) {
	const existing = await requireOwnedReminder(env, userId, reminderId);
	if (existing.status === "cancelled") {
		throw new CalendarInputError("A cancelled reminder cannot be dismissed", 409);
	}
	const now = new Date();
	await getDb(env)
		.update(calendarReminders)
		.set({ status: "dismissed", dismissedAt: now, claimedAt: null, updatedAt: now })
		.where(and(eq(calendarReminders.id, reminderId), eq(calendarReminders.userId, userId)));
	return requireOwnedReminder(env, userId, reminderId);
}

export async function snoozeCalendarReminder(
	env: CloudflareEnv,
	userId: string,
	reminderId: string,
	untilValue: string,
	now = new Date(),
) {
	const existing = await requireOwnedReminder(env, userId, reminderId);
	if (existing.status === "cancelled") {
		throw new CalendarInputError("A cancelled reminder cannot be snoozed", 409);
	}
	const until = calendarInstant(untilValue, {
		allDay: false,
		label: "a snooze time",
	});
	if (!until || until <= now) throw new CalendarInputError("Snooze time must be in the future");
	await getDb(env)
		.update(calendarReminders)
		.set({
			status: "scheduled",
			remindAt: until,
			snoozedUntil: until,
			claimedAt: null,
			deliveredAt: null,
			dismissedAt: null,
			attemptCount: 0,
			lastError: null,
			updatedAt: now,
		})
		.where(and(eq(calendarReminders.id, reminderId), eq(calendarReminders.userId, userId)));
	return requireOwnedReminder(env, userId, reminderId);
}

export async function listCalendarReminderDeliveries(
	env: CloudflareEnv,
	userId: string,
	reminderId: string,
) {
	await requireOwnedReminder(env, userId, reminderId);
	return getDb(env)
		.select()
		.from(calendarReminderDeliveries)
		.where(
			and(
				eq(calendarReminderDeliveries.reminderId, reminderId),
				eq(calendarReminderDeliveries.userId, userId),
			),
		)
		.orderBy(asc(calendarReminderDeliveries.createdAt));
}

export async function dispatchDueCalendarReminders(
	env: CloudflareEnv,
	now = new Date(),
): Promise<{ claimed: number; delivered: number; failed: number }> {
	const nowSeconds = toEpochSeconds(now);
	const staleClaimSeconds = nowSeconds - REMINDER_CLAIM_TIMEOUT_SECONDS;
	const due = await env.DB.prepare(
		`SELECT r.id, r.user_id, r.mailbox_id, r.title, r.message, r.channel, r.recipient,
			r.from_addr, r.remind_at, r.snoozed_until, r.attempt_count
		 FROM calendar_reminders AS r
		 LEFT JOIN calendar_tasks AS t ON t.id = r.task_id
		 WHERE COALESCE(r.snoozed_until, r.remind_at) <= ?
		   AND (r.status = 'scheduled' OR (r.status = 'processing' AND r.claimed_at < ?))
		   AND (r.task_id IS NULL OR t.status = 'open')
		 ORDER BY COALESCE(r.snoozed_until, r.remind_at), r.id
		 LIMIT ?`,
	)
		.bind(nowSeconds, staleClaimSeconds, REMINDER_BATCH_LIMIT)
		.all<DueReminderRow>();
	let claimed = 0;
	let delivered = 0;
	let failed = 0;
	for (const reminder of due.results) {
		const claim = await env.DB.prepare(
			`UPDATE calendar_reminders
			 SET status = 'processing', claimed_at = ?, updated_at = ?
			 WHERE id = ?
			   AND COALESCE(snoozed_until, remind_at) <= ?
			   AND (status = 'scheduled' OR (status = 'processing' AND claimed_at < ?))
			   AND NOT EXISTS (
			     SELECT 1 FROM calendar_tasks AS t
			     WHERE t.id = calendar_reminders.task_id AND t.status = 'completed'
			   )`,
		)
			.bind(nowSeconds, nowSeconds, reminder.id, nowSeconds, staleClaimSeconds)
			.run();
		if (claim.meta.changes !== 1) continue;
		claimed += 1;
		try {
			if (await deliverClaimedReminder(env, reminder, now)) delivered += 1;
		} catch (error) {
			failed += 1;
			await recordReminderFailure(env, reminder, now, error instanceof Error ? error : null);
			console.error(
				JSON.stringify({
					event: "calendar_reminder_delivery_failed",
					reminderId: reminder.id,
					attempt: reminder.attempt_count + 1,
					error: error instanceof Error ? calendarErrorMessage(error) : "Reminder delivery failed",
				}),
			);
		}
	}
	return { claimed, delivered, failed };
}

async function deliverClaimedReminder(
	env: CloudflareEnv,
	reminder: DueReminderRow,
	now: Date,
): Promise<boolean> {
	const eligible = await env.DB.prepare(
		`SELECT r.id
		 FROM calendar_reminders AS r
		 LEFT JOIN calendar_tasks AS t ON t.id = r.task_id
		 WHERE r.id = ? AND r.status = 'processing'
		   AND (r.task_id IS NULL OR t.status = 'open')`,
	)
		.bind(reminder.id)
		.first<{ id: string }>();
	if (!eligible) return false;
	const scheduledFor = reminder.snoozed_until ?? reminder.remind_at;
	const idempotencyKey = await createScopedIdempotencyKey(
		"calendar-reminder",
		reminder.id,
		scheduledFor,
	);
	let outboundJobId: string | null = null;
	let messageId: string | null = null;
	let deliveryStatus: "delivered" | "queued" = "delivered";
	if (reminder.channel === "email") {
		if (!reminder.mailbox_id || !reminder.recipient || !reminder.from_addr) {
			throw new Error("Email reminder delivery settings are incomplete");
		}
		const queued = await queueEmail(
			env,
			{
				userId: reminder.user_id,
				mailboxId: reminder.mailbox_id,
				from: reminder.from_addr,
				to: reminder.recipient,
				subject: `Reminder: ${reminder.title}`,
				text: reminder.message || reminder.title,
			},
			{ idempotencyKey },
		);
		outboundJobId = queued.jobId;
		messageId = queued.messageId;
		deliveryStatus = "queued";
	}
	const nowSeconds = toEpochSeconds(now);
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO calendar_reminder_deliveries
				(id, reminder_id, user_id, scheduled_for, channel, status, idempotency_key,
				 outbound_job_id, message_id, attempt_count, error, created_at, delivered_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
			 ON CONFLICT(reminder_id, scheduled_for) DO UPDATE SET
				status = excluded.status,
				outbound_job_id = excluded.outbound_job_id,
				message_id = excluded.message_id,
				error = NULL,
				delivered_at = excluded.delivered_at`,
		).bind(
			newId("rmd"),
			reminder.id,
			reminder.user_id,
			scheduledFor,
			reminder.channel,
			deliveryStatus,
			idempotencyKey,
			outboundJobId,
			messageId,
			nowSeconds,
			nowSeconds,
		),
		env.DB.prepare(
			`UPDATE calendar_reminders
			 SET status = 'delivered', delivered_at = ?, claimed_at = NULL,
				 attempt_count = attempt_count + 1, last_error = NULL, updated_at = ?
			 WHERE id = ? AND status = 'processing'`,
		).bind(nowSeconds, nowSeconds, reminder.id),
	]);
	return true;
}

async function recordReminderFailure(
	env: CloudflareEnv,
	reminder: DueReminderRow,
	now: Date,
	error: Error | null,
): Promise<void> {
	const scheduledFor = reminder.snoozed_until ?? reminder.remind_at;
	const attempt = reminder.attempt_count + 1;
	const message = error ? calendarErrorMessage(error) : "Reminder delivery failed";
	const idempotencyKey = await createScopedIdempotencyKey(
		"calendar-reminder",
		reminder.id,
		scheduledFor,
	);
	const nowSeconds = toEpochSeconds(now);
	await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO calendar_reminder_deliveries
				(id, reminder_id, user_id, scheduled_for, channel, status, idempotency_key,
				 attempt_count, error, created_at)
			 VALUES (?, ?, ?, ?, ?, 'failed', ?, 1, ?, ?)
			 ON CONFLICT(reminder_id, scheduled_for) DO UPDATE SET
				status = 'failed',
				attempt_count = calendar_reminder_deliveries.attempt_count + 1,
				error = excluded.error`,
		).bind(
			newId("rmd"),
			reminder.id,
			reminder.user_id,
			scheduledFor,
			reminder.channel,
			idempotencyKey,
			message,
			nowSeconds,
		),
		env.DB.prepare(
			`UPDATE calendar_reminders
			 SET status = ?, claimed_at = NULL, attempt_count = ?, last_error = ?, updated_at = ?
			 WHERE id = ? AND status = 'processing'`,
		).bind(
			attempt >= MAX_REMINDER_ATTEMPTS ? "failed" : "scheduled",
			attempt,
			message,
			nowSeconds,
			reminder.id,
		),
	]);
}

async function calendarReminderDeliveryFields(
	env: CloudflareEnv,
	user: SessionUser,
	channel: "in_app" | "email",
	input: {
		mailboxId?: string | null;
		from?: string | null;
		recipient?: string | null;
	},
): Promise<{ mailboxId: string | null; fromAddr: string | null; recipient: string | null }> {
	if (channel === "in_app") {
		await requireCalendarMailboxAccess(env, user, input.mailboxId);
		return { mailboxId: input.mailboxId ?? null, fromAddr: null, recipient: null };
	}
	const sender = await requireCalendarSender(env, user, input.mailboxId, input.from);
	return {
		mailboxId: sender.mailboxId,
		fromAddr: sender.fromAddr,
		recipient: calendarEmail(input.recipient, "reminder recipient"),
	};
}

async function requireReminderTarget(
	env: CloudflareEnv,
	user: SessionUser,
	eventId: string | null | undefined,
	taskId: string | null | undefined,
): Promise<{ kind: "event" | "task"; id: string; title: string; timezone: string }> {
	if (Boolean(eventId) === Boolean(taskId)) {
		throw new CalendarInputError("A reminder must belong to exactly one event or task");
	}
	if (eventId) {
		const [event] = await getDb(env)
			.select({
				id: calendarEvents.id,
				title: calendarEvents.title,
				timezone: calendarEvents.timezone,
			})
			.from(calendarEvents)
			.where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, user.id)))
			.limit(1);
		if (!event) throw new CalendarInputError("Event not found", 404);
		return { kind: "event", ...event };
	}
	if (!taskId) throw new CalendarInputError("Task not found", 404);
	const [task] = await getDb(env)
		.select({
			id: calendarTasks.id,
			title: calendarTasks.title,
			timezone: calendarTasks.timezone,
			status: calendarTasks.status,
		})
		.from(calendarTasks)
		.where(
			and(
				eq(calendarTasks.id, taskId),
				or(eq(calendarTasks.userId, user.id), eq(calendarTasks.assigneeUserId, user.id)),
			),
		)
		.limit(1);
	if (!task) throw new CalendarInputError("Task not found", 404);
	if (task.status === "completed") {
		throw new CalendarInputError("A completed task cannot receive a new reminder", 409);
	}
	return { kind: "task", id: task.id, title: task.title, timezone: task.timezone };
}

async function requireOwnedReminder(env: CloudflareEnv, userId: string, reminderId: string) {
	const [reminder] = await getDb(env)
		.select()
		.from(calendarReminders)
		.where(and(eq(calendarReminders.id, reminderId), eq(calendarReminders.userId, userId)))
		.limit(1);
	if (!reminder) throw new CalendarInputError("Reminder not found", 404);
	return reminder;
}

async function requireOpenReminderTask(env: CloudflareEnv, taskId: string | null): Promise<void> {
	if (!taskId) return;
	const task = await env.DB.prepare("SELECT status FROM calendar_tasks WHERE id = ?")
		.bind(taskId)
		.first<{ status: string }>();
	if (!task || task.status === "completed") {
		throw new CalendarInputError("Reopen the task before scheduling a reminder", 409);
	}
}

function toEpochSeconds(value: Date): number {
	return Math.floor(value.getTime() / 1_000);
}
