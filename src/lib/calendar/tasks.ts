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
	or,
} from "drizzle-orm";
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
	calendarText,
	calendarTimezone,
	calendarTitle,
	rejectCalendarRecurrence,
} from "./validation";

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

export async function createCalendarTask(
	env: CloudflareEnv,
	user: SessionUser,
	input: CalendarTaskInput,
) {
	rejectCalendarRecurrence(input.recurrenceRule);
	await requireCalendarMailboxAccess(env, user, input.mailboxId);
	const assignee = await requireAssignableUser(env, input.assigneeUserId ?? user.id);
	const allDay = input.allDay ?? false;
	const now = new Date();
	const task = {
		id: newId("tsk"),
		userId: user.id,
		assigneeUserId: assignee.id,
		assignedAt: now,
		mailboxId: input.mailboxId ?? null,
		title: calendarTitle(input.title, "task title"),
		description: calendarText(input.description),
		dueAt: calendarInstant(input.dueAt, {
			allDay,
			label: "a task due date",
			optional: true,
		}),
		timezone: calendarTimezone(input.timezone),
		allDay,
		priority: calendarPriority(input.priority),
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
	rejectCalendarRecurrence(input.recurrenceRule);
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
	return requireAccessibleTask(env, user, taskId);
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
