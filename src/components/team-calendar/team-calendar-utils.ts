import { isTaskOverdue } from "@/components/calendar/calendar-utils";
import type { CalendarPriority } from "@/lib/calendar/types";
import type {
	TeamCalendarData,
	TeamCalendarEvent,
	TeamCalendarPerson,
	TeamCalendarTask,
} from "@/lib/team-calendar/types";

/** Distinct, mid-tone hues that read on white and as light tints. */
export const PERSON_COLORS = [
	"#2563eb",
	"#db2777",
	"#059669",
	"#d97706",
	"#7c3aed",
	"#dc2626",
	"#0891b2",
	"#65a30d",
	"#c026d3",
	"#ea580c",
	"#4f46e5",
	"#0d9488",
];
export const UNKNOWN_PERSON_COLOR = "#737373";

export type TeamCalendarKind = "all" | "tasks" | "events";
export type TeamTaskStatusFilter = "any" | "open" | "overdue" | "completed";

export type TeamCalendarFilters = {
	kind: TeamCalendarKind;
	title: string;
	status: TeamTaskStatusFilter;
	priority: CalendarPriority | "any";
	repeating: boolean;
};

export const DEFAULT_TEAM_FILTERS: TeamCalendarFilters = {
	kind: "all",
	title: "",
	status: "any",
	priority: "any",
	repeating: false,
};

export const TEAM_KIND_OPTIONS: Array<{ value: TeamCalendarKind; label: string }> = [
	{ value: "all", label: "Tasks and events" },
	{ value: "tasks", label: "Tasks" },
	{ value: "events", label: "Events" },
];

/** Whose a task is on the team calendar: the person doing it. */
export function taskPersonId(task: Pick<TeamCalendarTask, "assigneeUserId">): string {
	return task.assigneeUserId;
}

export function eventPersonId(event: Pick<TeamCalendarEvent, "ownerUserId">): string {
	return event.ownerUserId;
}

/**
 * Colors follow the people list's order (by name), so a person keeps their color
 * while the visible range changes. Past the palette, colors repeat.
 */
export function personColors(people: Pick<TeamCalendarPerson, "id">[]): Map<string, string> {
	return new Map(
		people.map((person, index) => [person.id, PERSON_COLORS[index % PERSON_COLORS.length]]),
	);
}

export function personInitials(name: string, email = ""): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (words.length >= 2) return `${words[0][0]}${words.at(-1)?.[0] ?? ""}`.toUpperCase();
	return (words[0] ?? email).slice(0, 2).toUpperCase();
}

/** Active filters other than the kind, for the toolbar's filter badge. */
export function activeFilterCount(filters: TeamCalendarFilters): number {
	return [
		filters.title.trim() !== "",
		filters.status !== "any",
		filters.priority !== "any",
		filters.repeating,
	].filter(Boolean).length;
}

/**
 * Items left after the filters and the people hidden in the legend. Status, priority,
 * and repeat filters describe tasks, so they never hide events.
 */
export function filterTeamCalendar(
	data: Pick<TeamCalendarData, "events" | "tasks">,
	filters: TeamCalendarFilters,
	hiddenPeople: ReadonlySet<string>,
	now = new Date(),
): { events: TeamCalendarEvent[]; tasks: TeamCalendarTask[] } {
	const title = filters.title.trim().toLowerCase();
	const titleMatches = (value: string) => !title || value.toLowerCase().includes(title);
	const events =
		filters.kind === "tasks"
			? []
			: data.events.filter(
					(event) => !hiddenPeople.has(eventPersonId(event)) && titleMatches(event.title),
				);
	const tasks =
		filters.kind === "events"
			? []
			: data.tasks.filter((task) => {
					if (hiddenPeople.has(taskPersonId(task)) || !titleMatches(task.title)) return false;
					if (filters.priority !== "any" && task.priority !== filters.priority) return false;
					if (filters.repeating && !task.recurrenceRule) return false;
					if (filters.status === "completed") return task.status === "completed";
					if (filters.status === "open") return task.status === "open";
					if (filters.status === "overdue") return isTaskOverdue(task, now);
					return true;
				});
	return { events, tasks };
}

/** Items per person in the loaded range, before filters. */
export function itemCounts(data: Pick<TeamCalendarData, "events" | "tasks">): Map<string, number> {
	const counts = new Map<string, number>();
	const add = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
	for (const event of data.events) add(eventPersonId(event));
	for (const task of data.tasks) add(taskPersonId(task));
	return counts;
}

/** People for the legend: everyone with items in range, then other active accounts. */
export function legendPeople(
	people: TeamCalendarPerson[],
	counts: ReadonlyMap<string, number>,
): TeamCalendarPerson[] {
	const listed = people.filter((person) => person.active || counts.has(person.id));
	return [
		...listed.filter((person) => counts.has(person.id)),
		...listed.filter((person) => !counts.has(person.id)),
	];
}
