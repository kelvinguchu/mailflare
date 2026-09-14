import { authFetch } from "@/lib/auth/client";
import type {
	CalendarEventInput,
	CalendarEventRecord,
	CalendarReminderDeliveryRecord,
	CalendarReminderInput,
	CalendarReminderListParams,
	CalendarReminderPatchInput,
	CalendarReminderRecord,
	CalendarTaskInput,
	CalendarTaskAssignee,
	CalendarTaskActivity,
	CalendarTaskListParams,
	CalendarTaskPatchInput,
	CalendarTaskRecord,
} from "./types";

type RequestOptions = {
	method?: "GET" | "POST" | "PATCH" | "DELETE";
	body?: unknown;
	idempotencyKey?: string;
};

export const calendarKeys = {
	all: ["calendar"] as const,
	events: (start: string, end: string) => ["calendar", "events", start, end] as const,
	/** Every task list; list data is always `CalendarTaskRecord[]`. */
	taskLists: ["calendar", "tasks"] as const,
	tasks: (params: CalendarTaskListParams) => ["calendar", "tasks", params] as const,
	taskDetails: ["calendar", "task"] as const,
	task: (taskId: string) => ["calendar", "task", taskId] as const,
	taskActivity: ["calendar", "task-activity"] as const,
	activity: (taskId: string) => ["calendar", "task-activity", taskId] as const,
	assignees: ["calendar", "assignees"] as const,
	reminderLists: ["calendar", "reminders"] as const,
	reminders: (params: CalendarReminderListParams) => ["calendar", "reminders", params] as const,
	deliveries: (reminderId: string) => ["calendar", "deliveries", reminderId] as const,
};

async function calendarRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const headers: Record<string, string> = {};
	if (options.body !== undefined) headers["Content-Type"] = "application/json";
	if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
	const response = await authFetch(path, {
		method: options.method ?? "GET",
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const data = (await response.json().catch(() => ({}))) as T & { error?: string };
	if (!response.ok) throw new Error(data.error ?? "The calendar request failed. Try again.");
	return data;
}

function query(params: Record<string, string | boolean | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== false) search.set(key, String(value));
	}
	const text = search.toString();
	return text ? `?${text}` : "";
}

function normalizeTask(task: Partial<CalendarTaskRecord> & { id: string }): CalendarTaskRecord {
	return {
		creatorUserId: "",
		creatorName: "",
		creatorEmail: "",
		assigneeUserId: "",
		assigneeName: "",
		assigneeEmail: "",
		completedByUserId: null,
		assignedAt: null,
		mailboxId: null,
		title: "",
		description: "",
		dueAt: null,
		timezone: "UTC",
		allDay: false,
		status: "open",
		priority: "none",
		completedAt: null,
		...task,
	};
}

export async function listCalendarTaskAssignees() {
	const data = await calendarRequest<{ assignees?: CalendarTaskAssignee[] }>(
		"/api/calendar/assignees",
	);
	return data.assignees ?? [];
}

export async function listCalendarTaskActivity(taskId: string) {
	const data = await calendarRequest<{ activity?: CalendarTaskActivity[] }>(
		`/api/calendar/tasks/${taskId}/activity`,
	);
	return data.activity ?? [];
}

function normalizeReminder(
	reminder: Partial<CalendarReminderRecord> & { id: string },
): CalendarReminderRecord {
	return {
		eventId: null,
		taskId: null,
		mailboxId: null,
		title: "",
		message: "",
		channel: "in_app",
		recipient: null,
		fromAddr: null,
		remindAt: new Date().toISOString(),
		timezone: "UTC",
		status: "scheduled",
		snoozedUntil: null,
		deliveredAt: null,
		dismissedAt: null,
		attemptCount: 0,
		lastError: null,
		...reminder,
	};
}

export async function listCalendarEvents(start: string, end: string) {
	const data = await calendarRequest<{ events?: CalendarEventRecord[] }>(
		`/api/calendar/events${query({ start, end })}`,
	);
	return data.events ?? [];
}

export async function getCalendarEvent(eventId: string) {
	const data = await calendarRequest<{ event: CalendarEventRecord }>(
		`/api/calendar/events/${eventId}`,
	);
	return data.event;
}

export async function saveCalendarEvent(
	eventId: string | null,
	input: CalendarEventInput,
	idempotencyKey: string,
) {
	const data = await calendarRequest<{ event: CalendarEventRecord }>(
		eventId ? `/api/calendar/events/${eventId}` : "/api/calendar/events",
		{ method: eventId ? "PATCH" : "POST", body: input, idempotencyKey },
	);
	return data.event;
}

export async function deleteCalendarEvent(eventId: string, idempotencyKey: string) {
	await calendarRequest(`/api/calendar/events/${eventId}`, { method: "DELETE", idempotencyKey });
}

export async function listCalendarTasks(params: CalendarTaskListParams) {
	const data = await calendarRequest<{ tasks?: CalendarTaskRecord[] }>(
		`/api/calendar/tasks${query(params)}`,
	);
	return (data.tasks ?? []).map(normalizeTask);
}

export async function getCalendarTask(taskId: string) {
	const data = await calendarRequest<{ task: CalendarTaskRecord }>(`/api/calendar/tasks/${taskId}`);
	return normalizeTask(data.task);
}

export async function createCalendarTask(input: CalendarTaskInput) {
	const data = await calendarRequest<{ task: CalendarTaskRecord }>("/api/calendar/tasks", {
		method: "POST",
		body: input,
	});
	return normalizeTask(data.task);
}

export async function updateCalendarTask(taskId: string, input: CalendarTaskPatchInput) {
	const data = await calendarRequest<{ task: CalendarTaskRecord }>(
		`/api/calendar/tasks/${taskId}`,
		{ method: "PATCH", body: input },
	);
	return normalizeTask(data.task);
}

export async function deleteCalendarTask(taskId: string) {
	await calendarRequest(`/api/calendar/tasks/${taskId}`, { method: "DELETE" });
}

export async function setCalendarTaskCompleted(taskId: string, completed: boolean) {
	const data = await calendarRequest<{ task: CalendarTaskRecord }>(
		`/api/calendar/tasks/${taskId}/complete`,
		{ method: completed ? "POST" : "DELETE" },
	);
	return normalizeTask(data.task);
}

export async function listCalendarReminders(params: CalendarReminderListParams) {
	const data = await calendarRequest<{ reminders?: CalendarReminderRecord[] }>(
		`/api/calendar/reminders${query(params)}`,
	);
	return (data.reminders ?? []).map(normalizeReminder);
}

export async function createCalendarReminder(input: CalendarReminderInput) {
	const data = await calendarRequest<{ reminder: CalendarReminderRecord }>(
		"/api/calendar/reminders",
		{ method: "POST", body: input },
	);
	return normalizeReminder(data.reminder);
}

export async function updateCalendarReminder(
	reminderId: string,
	input: CalendarReminderPatchInput,
) {
	const data = await calendarRequest<{ reminder: CalendarReminderRecord }>(
		`/api/calendar/reminders/${reminderId}`,
		{ method: "PATCH", body: input },
	);
	return normalizeReminder(data.reminder);
}

export async function cancelCalendarReminder(reminderId: string) {
	const data = await calendarRequest<{ reminder: CalendarReminderRecord }>(
		`/api/calendar/reminders/${reminderId}`,
		{ method: "DELETE" },
	);
	return normalizeReminder(data.reminder);
}

export async function dismissCalendarReminder(reminderId: string) {
	const data = await calendarRequest<{ reminder: CalendarReminderRecord }>(
		`/api/calendar/reminders/${reminderId}/dismiss`,
		{ method: "POST" },
	);
	return normalizeReminder(data.reminder);
}

export async function snoozeCalendarReminder(reminderId: string, until: string) {
	const data = await calendarRequest<{ reminder: CalendarReminderRecord }>(
		`/api/calendar/reminders/${reminderId}/snooze`,
		{ method: "POST", body: { until } },
	);
	return normalizeReminder(data.reminder);
}

export async function listCalendarReminderDeliveries(reminderId: string) {
	const data = await calendarRequest<{ deliveries?: CalendarReminderDeliveryRecord[] }>(
		`/api/calendar/reminders/${reminderId}/deliveries`,
	);
	return data.deliveries ?? [];
}

export function parseEventAttendees(event: Pick<CalendarEventRecord, "attendees">): string[] {
	try {
		const attendees = JSON.parse(event.attendees || "[]") as unknown;
		return Array.isArray(attendees)
			? attendees.filter((value): value is string => typeof value === "string")
			: [];
	} catch {
		return [];
	}
}
