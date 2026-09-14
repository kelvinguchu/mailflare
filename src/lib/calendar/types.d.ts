export type CalendarPriority = "none" | "low" | "medium" | "high";
export type CalendarTaskStatus = "open" | "completed";
export type CalendarTaskScope = "assigned" | "created" | "all";
export type CalendarReminderChannel = "in_app" | "email";
export type CalendarReminderStatus =
	"scheduled" | "processing" | "delivered" | "dismissed" | "cancelled" | "failed";

export type CalendarEventInput = {
	title: string;
	description?: string;
	location?: string;
	attendees?: string[];
	startsAt: string;
	endsAt: string;
	timezone?: string;
	allDay?: boolean;
	mailboxId?: string | null;
	from?: string;
	recurrenceRule?: string | null;
};

export type CalendarTaskInput = {
	title: string;
	description?: string;
	dueAt?: string | null;
	timezone?: string;
	allDay?: boolean;
	priority?: CalendarPriority;
	mailboxId?: string | null;
	recurrenceRule?: string | null;
	assigneeUserId?: string;
};

export type CalendarTaskPatchInput = Partial<CalendarTaskInput>;

export type CalendarReminderInput = {
	eventId?: string | null;
	taskId?: string | null;
	title?: string;
	message?: string;
	channel?: CalendarReminderChannel;
	recipient?: string | null;
	mailboxId?: string | null;
	from?: string | null;
	remindAt: string;
	timezone?: string;
};

export type CalendarReminderPatchInput = Partial<
	Pick<
		CalendarReminderInput,
		"title" | "message" | "channel" | "recipient" | "mailboxId" | "from" | "remindAt" | "timezone"
	>
>;

export type CalendarSnoozeInput = {
	until: string;
};

export type CalendarRouteParams<Key extends string> = {
	params: Promise<Record<Key, string>>;
};

/** An event as the calendar API returns it; timestamps are JSON-serialized. */
export type CalendarEventRecord = {
	id: string;
	mailboxId: string | null;
	title: string;
	description: string;
	location: string;
	/** JSON array of attendee addresses. */
	attendees: string;
	organizer: string | null;
	startsAt: string;
	endsAt: string;
	timezone: string;
	allDay: boolean;
	sequence: number;
	createdAt?: string;
	updatedAt?: string;
};

export type CalendarTaskRecord = {
	id: string;
	creatorUserId: string;
	creatorName: string;
	creatorEmail: string;
	assigneeUserId: string;
	assigneeName: string;
	assigneeEmail: string;
	completedByUserId: string | null;
	assignedAt: string | null;
	mailboxId: string | null;
	title: string;
	description: string;
	dueAt: string | null;
	timezone: string;
	allDay: boolean;
	status: CalendarTaskStatus;
	priority: CalendarPriority;
	completedAt: string | null;
	createdAt?: string;
	updatedAt?: string;
};

export type CalendarReminderRecord = {
	id: string;
	eventId: string | null;
	taskId: string | null;
	mailboxId: string | null;
	title: string;
	message: string;
	channel: CalendarReminderChannel;
	recipient: string | null;
	fromAddr: string | null;
	remindAt: string;
	timezone: string;
	status: CalendarReminderStatus;
	snoozedUntil: string | null;
	deliveredAt: string | null;
	dismissedAt: string | null;
	attemptCount: number;
	lastError: string | null;
	createdAt?: string;
	updatedAt?: string;
};

export type CalendarReminderDeliveryRecord = {
	id: string;
	reminderId: string;
	scheduledFor: string;
	channel: CalendarReminderChannel;
	status: "delivered" | "queued" | "failed";
	outboundJobId: string | null;
	messageId: string | null;
	attemptCount: number;
	error: string | null;
	createdAt: string;
	deliveredAt: string | null;
};

export type CalendarTaskListParams = {
	status?: CalendarTaskStatus | "all";
	scope?: CalendarTaskScope;
	overdue?: boolean;
	start?: string;
	end?: string;
};

export type CalendarTaskAssignee = {
	id: string;
	name: string;
	email: string;
	hasAvatar: boolean;
};

export type CalendarTaskActivity = {
	id: string;
	action: "created" | "updated" | "reassigned" | "completed" | "reopened" | "deleted";
	actorUserId: string | null;
	actorName: string | null;
	actorEmail: string | null;
	createdAt: string;
};

export type CalendarReminderListParams = {
	status?: CalendarReminderStatus | "all";
	due?: boolean;
	eventId?: string;
	taskId?: string;
	start?: string;
	end?: string;
};
