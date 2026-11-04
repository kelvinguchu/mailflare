import {
	and,
	asc,
	eq,
	getTableColumns,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	ne,
	or,
} from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "@/db";
import {
	auditLogs,
	calendarReminderDeliveries,
	calendarReminders,
	calendarTasks,
	messages,
	outboundJobs,
	users,
} from "@/db/schema";
import type { SessionUser } from "@/lib/auth/types";
import { newId } from "@/lib/ids";
import { notifyUsersOfTaskChange } from "@/lib/realtime/utils";
import type { TaskChangeNotification } from "@/lib/realtime/types";
import { requireCalendarMailboxAccess } from "./access";
import { nextTaskOccurrence, parseRecurrenceRule } from "./recurrence";
import type {
	CalendarTaskInput,
	CalendarTaskPatchInput,
	CalendarTaskScope,
	CalendarTaskStatus,
} from "./types";
import {
	CalendarInputError,
	calendarInstant,
	calendarPriority,
	calendarTaskRecurrence,
	calendarText,
	calendarTimezone,
	calendarTitle,
} from "./validation";
import { addDaysToKey, instantToWallClock, wallClockToInstant } from "./wall-clock";

export type CalendarTaskFilters = {
	status: CalendarTaskStatus | "all";
	scope: CalendarTaskScope;
	overdue: boolean;
	start: Date | null;
	end: Date | null;
	now?: Date;
};

const assignees = alias(users, "calendar_task_assignees");
const taskSelection = {
	...getTableColumns(calendarTasks),
	creatorUserId: users.id,
	creatorName: users.name,
	creatorEmail: users.email,
	assigneeName: assignees.name,
	assigneeEmail: assignees.email,
};

type SelectedTask = typeof calendarTasks.$inferSelect & {
	creatorUserId: string;
	creatorName: string;
	creatorEmail: string;
	assigneeName: string | null;
	assigneeEmail: string | null;
};

export async function listCalendarTaskAssignees(env: CloudflareEnv) {
	const rows = await getDb(env)
		.select({ id: users.id, name: users.name, email: users.email, avatarKey: users.avatarKey })
		.from(users)
		.where(and(eq(users.activationStatus, "active"), eq(users.disabled, false)))
		.orderBy(asc(users.name), asc(users.email))
		.limit(200);
	return rows.map(({ avatarKey, ...account }) => ({ ...account, hasAvatar: !!avatarKey }));
}

export async function listCalendarTasks(
	env: CloudflareEnv,
	user: SessionUser,
	filters: CalendarTaskFilters,
) {
	const now = filters.now ?? new Date();
	const rows = await getDb(env)
		.select(taskSelection)
		.from(calendarTasks)
		.innerJoin(users, eq(calendarTasks.userId, users.id))
		.leftJoin(assignees, eq(calendarTasks.assigneeUserId, assignees.id))
		.where(
			and(
				taskScopeCondition(user.id, filters.scope),
				filters.status === "all" ? undefined : eq(calendarTasks.status, filters.status),
				filters.overdue
					? and(
							isNotNull(calendarTasks.dueAt),
							lt(calendarTasks.dueAt, now),
							eq(calendarTasks.status, "open"),
						)
					: undefined,
				filters.start ? gte(calendarTasks.dueAt, filters.start) : undefined,
				filters.end ? lt(calendarTasks.dueAt, filters.end) : undefined,
			),
		)
		.orderBy(asc(calendarTasks.dueAt))
		.limit(200);
	return rows.map(normalizeTaskPeople);
}

/**
 * Every account's tasks due in a range, plus open repeating tasks due before it whose
 * later occurrences may fall inside it. Team inspection only: callers check access.
 */
export async function listTeamCalendarTasks(
	env: CloudflareEnv,
	range: { start: Date; end: Date },
	limit = 1_000,
) {
	const select = (where: ReturnType<typeof and>, max: number) =>
		getDb(env)
			.select(taskSelection)
			.from(calendarTasks)
			.innerJoin(users, eq(calendarTasks.userId, users.id))
			.leftJoin(assignees, eq(calendarTasks.assigneeUserId, assignees.id))
			.where(where)
			.orderBy(asc(calendarTasks.dueAt), asc(calendarTasks.id))
			.limit(max);
	const [inRange, repeatingBefore] = await Promise.all([
		select(
			and(gte(calendarTasks.dueAt, range.start), lt(calendarTasks.dueAt, range.end)),
			limit + 1,
		),
		select(
			and(
				lt(calendarTasks.dueAt, range.start),
				eq(calendarTasks.status, "open"),
				isNotNull(calendarTasks.recurrenceRule),
			),
			limit,
		),
	]);
	return {
		tasks: inRange.slice(0, limit).map(normalizeTaskPeople),
		repeatingBefore: repeatingBefore.map(normalizeTaskPeople),
		truncated: inRange.length > limit,
	};
}

export async function createCalendarTask(
	env: CloudflareEnv,
	user: SessionUser,
	input: CalendarTaskInput,
) {
	await requireCalendarMailboxAccess(env, user, input.mailboxId);
	const assignee = await requireAssignableUser(env, input.assigneeUserId ?? user.id);
	const allDay = input.allDay ?? false;
	const now = new Date();
	const id = newId("tsk");
	const dueAt = calendarInstant(input.dueAt, {
		allDay,
		label: "a task due date",
		optional: true,
	});
	const timezone = calendarTimezone(input.timezone);
	const recurrenceRule = calendarTaskRecurrence(input.recurrenceRule, { dueAt, allDay, timezone });
	const task = {
		id,
		userId: user.id,
		assigneeUserId: assignee.id,
		assignedAt: now,
		mailboxId: input.mailboxId ?? null,
		title: calendarTitle(input.title, "task title"),
		description: calendarText(input.description),
		dueAt,
		timezone,
		allDay,
		priority: calendarPriority(input.priority),
		recurrenceRule,
		recurrenceSeriesId: recurrenceRule ? id : null,
		recurrenceIndex: recurrenceRule ? 0 : null,
	};
	const db = getDb(env);
	await db.batch([
		db.insert(calendarTasks).values(task),
		db.insert(auditLogs).values(
			taskAudit(user.id, assignee.id, "calendar.task_created", task.id, {
				assigneeUserId: assignee.id,
			}),
		),
	]);
	await notifyTaskParticipants(env, [assignee.id], user, task.id, task.title, "assigned");
	return requireAccessibleTask(env, user, task.id);
}

export async function updateCalendarTask(
	env: CloudflareEnv,
	user: SessionUser,
	taskId: string,
	input: CalendarTaskPatchInput,
) {
	const existing = await requireAccessibleTask(env, user, taskId);
	if (input.mailboxId !== undefined) await requireCalendarMailboxAccess(env, user, input.mailboxId);
	const changes: Partial<typeof calendarTasks.$inferInsert> = { updatedAt: new Date() };
	const allDay = input.allDay ?? existing.allDay;
	if (input.title !== undefined) changes.title = calendarTitle(input.title, "task title");
	if (input.description !== undefined) changes.description = calendarText(input.description);
	if (input.dueAt !== undefined) {
		changes.dueAt = calendarInstant(input.dueAt, {
			allDay,
			label: "a task due date",
			optional: true,
		});
	}
	if (input.timezone !== undefined) changes.timezone = calendarTimezone(input.timezone);
	if (input.allDay !== undefined) changes.allDay = input.allDay;
	if (input.priority !== undefined) changes.priority = calendarPriority(input.priority);
	if (input.mailboxId !== undefined) changes.mailboxId = input.mailboxId;
	const dueAt = changes.dueAt === undefined ? existing.dueAt : changes.dueAt;
	if (input.recurrenceRule !== undefined) {
		const recurrenceRule = calendarTaskRecurrence(input.recurrenceRule, {
			dueAt,
			allDay,
			timezone: changes.timezone ?? existing.timezone,
		});
		if (recurrenceRule !== existing.recurrenceRule) {
			// A changed rule starts a new series here, so its end count runs from this task.
			changes.recurrenceRule = recurrenceRule;
			changes.recurrenceSeriesId = recurrenceRule ? taskId : null;
			changes.recurrenceIndex = recurrenceRule ? 0 : null;
		}
	} else if (existing.recurrenceRule && !dueAt) {
		throw new CalendarInputError("Stop repeating this task before removing its due date");
	}

	let action = "calendar.task_updated";
	let targetUserId = existing.assigneeUserId;
	if (input.assigneeUserId !== undefined && input.assigneeUserId !== existing.assigneeUserId) {
		if (existing.creatorUserId !== user.id) {
			throw new CalendarInputError("Only the task creator can reassign it", 403);
		}
		const assignee = await requireAssignableUser(env, input.assigneeUserId);
		changes.assigneeUserId = assignee.id;
		changes.assignedAt = new Date();
		targetUserId = assignee.id;
		action = "calendar.task_reassigned";
	}
	const db = getDb(env);
	await db.batch([
		db.update(calendarTasks).set(changes).where(eq(calendarTasks.id, taskId)),
		db.insert(auditLogs).values(
			taskAudit(user.id, targetUserId, action, taskId, {
				previousAssigneeUserId: existing.assigneeUserId,
				assigneeUserId: targetUserId,
			}),
		),
	]);
	await notifyTaskParticipants(
		env,
		[existing.creatorUserId, existing.assigneeUserId, targetUserId],
		user,
		taskId,
		changes.title ?? existing.title,
		action === "calendar.task_reassigned" ? "reassigned" : "updated",
	);
	return requireAccessibleTask(env, user, taskId);
}

export async function deleteCalendarTask(
	env: CloudflareEnv,
	user: SessionUser,
	taskId: string,
): Promise<void> {
	const existing = await requireAccessibleTask(env, user, taskId);
	if (existing.creatorUserId !== user.id && user.role !== "admin") {
		throw new CalendarInputError("Only the task creator can delete it", 403);
	}
	const db = getDb(env);
	await db.batch([
		db
			.insert(auditLogs)
			.values(taskAudit(user.id, existing.assigneeUserId, "calendar.task_deleted", taskId)),
		db.delete(calendarTasks).where(eq(calendarTasks.id, taskId)),
	]);
	await notifyTaskParticipants(
		env,
		[existing.creatorUserId, existing.assigneeUserId],
		user,
		taskId,
		existing.title,
		"deleted",
	);
}

export async function setCalendarTaskCompleted(
	env: CloudflareEnv,
	user: SessionUser,
	taskId: string,
	completed: boolean,
) {
	const existing = await requireAccessibleTask(env, user, taskId);
	const now = new Date();
	const db = getDb(env);
	const next = completed ? await nextOccurrenceStatements(env, existing, user.id, now) : null;
	const taskUpdate = db
		.update(calendarTasks)
		.set({
			status: completed ? "completed" : "open",
			completedAt: completed ? now : null,
			completedByUserId: completed ? user.id : null,
			updatedAt: now,
		})
		.where(eq(calendarTasks.id, taskId));
	const activity = db
		.insert(auditLogs)
		.values(
			taskAudit(
				user.id,
				existing.assigneeUserId,
				completed ? "calendar.task_completed" : "calendar.task_reopened",
				taskId,
			),
		);
	if (completed) {
		const reminderJobIds = db
			.select({ id: calendarReminderDeliveries.outboundJobId })
			.from(calendarReminderDeliveries)
			.innerJoin(calendarReminders, eq(calendarReminderDeliveries.reminderId, calendarReminders.id))
			.where(
				and(
					eq(calendarReminders.taskId, taskId),
					isNotNull(calendarReminderDeliveries.outboundJobId),
				),
			);
		const reminderMessageIds = db
			.select({ id: outboundJobs.messageId })
			.from(outboundJobs)
			.where(and(inArray(outboundJobs.id, reminderJobIds), isNotNull(outboundJobs.messageId)));
		const cancelReminders = db
			.update(calendarReminders)
			.set({ status: "cancelled", claimedAt: null, updatedAt: now })
			.where(
				and(
					eq(calendarReminders.taskId, taskId),
					inArray(calendarReminders.status, ["scheduled", "processing"]),
				),
			);
		const cancelOutboundJobs = db
			.update(outboundJobs)
			.set({ status: "canceled", canceledAt: now, error: null, updatedAt: now })
			.where(
				and(
					inArray(outboundJobs.id, reminderJobIds),
					inArray(outboundJobs.status, ["scheduled", "queued"]),
					isNull(outboundJobs.deliveryStartedAt),
				),
			);
		const cancelOutboundMessages = db
			.update(messages)
			.set({
				status: "canceled",
				deliveryStatus: "canceled",
				deliveryDetail: "Task completed before reminder delivery",
				deliveryUpdatedAt: now,
			})
			.where(inArray(messages.id, reminderMessageIds));
		await db.batch([
			taskUpdate,
			cancelReminders,
			cancelOutboundJobs,
			cancelOutboundMessages,
			activity,
			...(next?.statements ?? []),
		]);
	} else {
		await db.batch([taskUpdate, activity]);
	}
	await notifyTaskParticipants(
		env,
		[existing.creatorUserId, existing.assigneeUserId],
		user,
		taskId,
		existing.title,
		completed ? "completed" : "reopened",
	);
	const task = await requireAccessibleTask(env, user, taskId);
	return { ...task, nextTask: next ? await findTask(env, user, next.taskId) : null };
}

/**
 * The inserts for a repeating task's next occurrence and its carried-over reminders.
 * Their ids derive from the completed task, so completing, reopening, and completing
 * again never creates a second copy or duplicate reminders.
 */
async function nextOccurrenceStatements(
	env: CloudflareEnv,
	existing: Awaited<ReturnType<typeof requireAccessibleTask>>,
	actorUserId: string,
	now: Date,
) {
	if (existing.status !== "open" || !existing.recurrenceRule || !existing.dueAt) return null;
	const seriesId = existing.recurrenceSeriesId ?? existing.id;
	const next = nextTaskOccurrence(
		parseRecurrenceRule(existing.recurrenceRule),
		{
			dueAt: existing.dueAt,
			allDay: existing.allDay,
			timezone: existing.timezone,
			index: existing.recurrenceIndex ?? 0,
		},
		now,
	);
	if (!next) return null;
	const db = getDb(env);
	const taskId = await derivedId("tsk", "next-occurrence", existing.id);
	const reminders = await db
		.select()
		.from(calendarReminders)
		.where(
			and(eq(calendarReminders.taskId, existing.id), ne(calendarReminders.status, "cancelled")),
		);
	const carried = await Promise.all(
		reminders.map(async (reminder) => ({
			id: await derivedId("rem", reminder.id, taskId),
			userId: reminder.userId,
			taskId,
			mailboxId: reminder.mailboxId,
			title: reminder.title,
			message: reminder.message,
			channel: reminder.channel,
			recipient: reminder.recipient,
			fromAddr: reminder.fromAddr,
			remindAt: shiftReminderTime(reminder, existing.dueAt!, next.dueAt, existing.allDay),
			timezone: reminder.timezone,
			createdAt: now,
			updatedAt: now,
		})),
	);
	const statements: BatchItem<"sqlite">[] = [
		db
			.insert(calendarTasks)
			.values({
				id: taskId,
				userId: existing.userId,
				assigneeUserId: existing.assigneeUserId,
				assignedAt: existing.assignedAt,
				mailboxId: existing.mailboxId,
				title: existing.title,
				description: existing.description,
				dueAt: next.dueAt,
				timezone: existing.timezone,
				allDay: existing.allDay,
				priority: existing.priority,
				recurrenceRule: existing.recurrenceRule,
				recurrenceSeriesId: seriesId,
				recurrenceIndex: next.index,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing(),
		db
			.insert(auditLogs)
			.values({
				...taskAudit(actorUserId, existing.assigneeUserId, "calendar.task_created", taskId, {
					previousTaskId: existing.id,
					recurrenceSeriesId: seriesId,
				}),
				id: await derivedId("aud", "created", taskId),
			})
			.onConflictDoNothing(),
	];
	if (carried.length > 0) {
		statements.push(db.insert(calendarReminders).values(carried).onConflictDoNothing());
	}
	return { taskId, statements };
}

async function derivedId(prefix: string, ...parts: string[]): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join(":")));
	const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"));
	return `${prefix}_${hex.join("").slice(0, 24)}`;
}

/** Keeps a reminder's distance from the due date; all-day reminders keep their wall-clock time. */
function shiftReminderTime(
	reminder: { remindAt: Date; timezone: string },
	from: Date,
	to: Date,
	allDay: boolean,
): Date {
	if (!allDay) return new Date(reminder.remindAt.getTime() + to.getTime() - from.getTime());
	const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
	const wallClock = instantToWallClock(reminder.remindAt, reminder.timezone);
	return wallClockToInstant(
		`${addDaysToKey(wallClock.slice(0, 10), days)}${wallClock.slice(10)}`,
		reminder.timezone,
	);
}

async function findTask(env: CloudflareEnv, user: SessionUser, taskId: string) {
	try {
		return await requireAccessibleTask(env, user, taskId);
	} catch (error) {
		if (error instanceof CalendarInputError) return null;
		throw error;
	}
}

export async function requireAccessibleTask(env: CloudflareEnv, user: SessionUser, taskId: string) {
	const [task] = await getDb(env)
		.select(taskSelection)
		.from(calendarTasks)
		.innerJoin(users, eq(calendarTasks.userId, users.id))
		.leftJoin(assignees, eq(calendarTasks.assigneeUserId, assignees.id))
		.where(
			and(
				eq(calendarTasks.id, taskId),
				or(eq(calendarTasks.userId, user.id), eq(calendarTasks.assigneeUserId, user.id)),
			),
		)
		.limit(1);
	if (!task) throw new CalendarInputError("Task not found", 404);
	return normalizeTaskPeople(task);
}

export async function requireOwnedTask(env: CloudflareEnv, userId: string, taskId: string) {
	const [task] = await getDb(env)
		.select(taskSelection)
		.from(calendarTasks)
		.innerJoin(users, eq(calendarTasks.userId, users.id))
		.leftJoin(assignees, eq(calendarTasks.assigneeUserId, assignees.id))
		.where(and(eq(calendarTasks.id, taskId), eq(calendarTasks.userId, userId)))
		.limit(1);
	if (!task) throw new CalendarInputError("Task not found", 404);
	return normalizeTaskPeople(task);
}

export async function listCalendarTaskActivity(
	env: CloudflareEnv,
	user: SessionUser,
	taskId: string,
) {
	await requireAccessibleTask(env, user, taskId);
	const result = await env.DB.prepare(
		`SELECT a.id, a.action, a.actor_user_id, a.created_at, u.name AS actor_name,
			u.email AS actor_email
		 FROM audit_logs AS a
		 LEFT JOIN users AS u ON u.id = a.actor_user_id
		 WHERE a.action LIKE 'calendar.task_%'
		   AND json_extract(a.metadata, '$.taskId') = ?
		 ORDER BY a.created_at DESC, a.id DESC
		 LIMIT 50`,
	)
		.bind(taskId)
		.all<{
			id: string;
			action: string;
			actor_user_id: string | null;
			actor_name: string | null;
			actor_email: string | null;
			created_at: number;
		}>();
	return result.results.map((row) => ({
		id: row.id,
		action: row.action.replace("calendar.task_", ""),
		actorUserId: row.actor_user_id,
		actorName: row.actor_name,
		actorEmail: row.actor_email,
		createdAt: new Date(row.created_at * 1_000).toISOString(),
	}));
}

function taskScopeCondition(userId: string, scope: CalendarTaskScope) {
	if (scope === "assigned") return eq(calendarTasks.assigneeUserId, userId);
	if (scope === "created") return eq(calendarTasks.userId, userId);
	return or(eq(calendarTasks.userId, userId), eq(calendarTasks.assigneeUserId, userId));
}

async function requireAssignableUser(env: CloudflareEnv, userId: string) {
	const [assignee] = await getDb(env)
		.select({ id: users.id })
		.from(users)
		.where(
			and(eq(users.id, userId), eq(users.activationStatus, "active"), eq(users.disabled, false)),
		)
		.limit(1);
	if (!assignee) throw new CalendarInputError("Choose an active account as the assignee", 400);
	return assignee;
}

function normalizeTaskPeople(task: SelectedTask) {
	return {
		...task,
		assigneeUserId: task.assigneeUserId ?? task.creatorUserId,
		assigneeName: task.assigneeName ?? task.creatorName,
		assigneeEmail: task.assigneeEmail ?? task.creatorEmail,
	};
}

function taskAudit(
	actorUserId: string,
	targetUserId: string,
	action: string,
	taskId: string,
	metadata: Record<string, string> = {},
) {
	return {
		id: newId("aud"),
		actorUserId,
		targetUserId,
		action,
		metadata: JSON.stringify({ taskId, ...metadata }),
	};
}

async function notifyTaskParticipants(
	env: CloudflareEnv,
	participantIds: string[],
	actor: SessionUser,
	taskId: string,
	title: string,
	action: TaskChangeNotification["task"]["action"],
): Promise<void> {
	const userIds = [...new Set(participantIds)].filter((userId) => userId !== actor.id);
	if (userIds.length === 0) return;
	const now = new Date().toISOString();
	await notifyUsersOfTaskChange(env, userIds, {
		version: 1,
		type: "task_changed",
		eventId: `task:${taskId}:${action}:${Date.now()}`,
		occurredAt: now,
		publishedAt: now,
		task: { id: taskId, title, action, actorName: actor.name },
	});
}
