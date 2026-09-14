import type {
	CalendarEventRecord,
	CalendarReminderRecord,
	CalendarTaskRecord,
} from "@/lib/calendar/types";

export type CalendarView = "month" | "week" | "day";

export type SenderOption = {
	key: string;
	mailboxId: string;
	address: string;
};

export type TimedChoice = {
	id: string;
	label: string;
	at: Date;
};

/** The single event or task a reminder belongs to. */
export type ReminderTarget = {
	kind: "event" | "task";
	id: string;
	title: string;
	timezone: string;
	/** Event start or task due date the quick choices are relative to. */
	anchor: { value: string; allDay: boolean } | null;
	/** Completed tasks cannot receive new reminders. */
	locked?: boolean;
};

export type EventDraft = {
	start: Date;
	end: Date;
	allDay: boolean;
};

export type EventDialogState =
	{ mode: "create"; draft: EventDraft } | { mode: "view"; event: CalendarEventRecord };

export type TaskDialogState =
	{ mode: "create"; dueKey?: string; title?: string } | { mode: "view"; task: CalendarTaskRecord };

export type ReminderDialogState = {
	target: ReminderTarget;
	reminder?: CalendarReminderRecord;
};

export type CalendarGridProps = {
	days: Date[];
	anchor: Date;
	events: CalendarEventRecord[];
	tasks: CalendarTaskRecord[];
	onSelectEvent: (event: CalendarEventRecord) => void;
	onSelectTask: (task: CalendarTaskRecord) => void;
	onCreateEvent: (draft: EventDraft) => void;
	onOpenDay: (day: Date) => void;
};
