import type { CalendarEventRecord, CalendarTaskRecord } from "@/lib/calendar/types";

export type TeamCalendarPerson = {
	id: string;
	name: string;
	email: string;
	/** Disabled or archived accounts still own items but can't act on them. */
	active: boolean;
};

export type TeamCalendarEvent = CalendarEventRecord & { ownerUserId: string };

export type TeamCalendarTask = CalendarTaskRecord & {
	/** The stored task; occurrences that don't exist yet share it with the open one. */
	taskId: string;
	/** A later occurrence of a repeating task, created when the one before it is completed. */
	upcoming: boolean;
};

export type TeamCalendarData = {
	people: TeamCalendarPerson[];
	events: TeamCalendarEvent[];
	tasks: TeamCalendarTask[];
	/** The range held more items than one response returns. */
	truncated: boolean;
};
