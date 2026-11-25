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
	importUid?: string | null;
	importOrganizer?: string | null;
	importCancelled?: boolean;
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
	/** Canonical repeat rule; completing this occurrence creates the next one. */
	recurrenceRule?: string | null;
	recurrenceSeriesId?: string | null;
	recurrenceIndex?: number | null;
	createdAt?: string;
	updatedAt?: string;
};

export type CalendarTaskCompletion = {
	task: CalendarTaskRecord;
	/** The next occurrence a repeating task created, when one was created. */
	nextTask: CalendarTaskRecord | null;
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

export type CalendarTaskActivityAction =
	"created" | "updated" | "reassigned" | "completed" | "reopened" | "deleted";

/** Someone a change names. `name` is null when the account no longer exists. */
export type TaskActivityPerson = { id: string; name: string | null };

/** A due date as it was: all-day values are UTC midnight, timed ones read in `timezone`. */
export type TaskActivityDue = { at: string; allDay: boolean; timezone: string };

/** One field of a task as it changed. A null side means the field was empty. */
export type TaskActivityChange =
	| { field: "title"; from: string; to: string }
	| { field: "description"; change: "added" | "edited" | "removed" }
	| { field: "due"; from: TaskActivityDue | null; to: TaskActivityDue | null }
	| { field: "priority"; from: CalendarPriority; to: CalendarPriority }
	| { field: "assignee"; from: TaskActivityPerson | null; to: TaskActivityPerson }
	/** Canonical repeat rules. */
	| { field: "repeat"; from: string | null; to: string | null }
	/** A reminder added (no `from`), removed (no `to`), or moved to another time. */
	| {
			field: "reminder";
			from: string | null;
			to: string | null;
			timezone: string;
			channel: CalendarReminderChannel;
	  }
	| { field: "mailbox" };

/** What an activity entry records beyond its action. */
export type TaskActivityDetails = {
	/** Every field one save changed, in display order. */
	changes?: TaskActivityChange[];
	/** On creation: who the task was assigned to. */
	assignee?: TaskActivityPerson;
	/** On creation: the task is the next occurrence of a repeating task. */
	nextOccurrence?: boolean;
	/** On deletion: the title the task had. */
	title?: string;
};

export type CalendarTaskActivity = {
	id: string;
	action: CalendarTaskActivityAction;
	actorUserId: string | null;
	actorName: string | null;
	actorEmail: string | null;
	createdAt: string;
	/** Null for entries recorded before changes were stored. */
	details: TaskActivityDetails | null;
};

export type CalendarReminderListParams = {
	status?: CalendarReminderStatus | "all";
	due?: boolean;
	eventId?: string;
	taskId?: string;
	start?: string;
	end?: string;
};
