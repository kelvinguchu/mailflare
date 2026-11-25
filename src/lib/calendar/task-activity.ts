import { newId } from "@/lib/ids";
import type {
	CalendarPriority,
	CalendarReminderChannel,
	CalendarTaskActivityAction,
	TaskActivityChange,
	TaskActivityDetails,
	TaskActivityDue,
	TaskActivityPerson,
} from "./types";

/**
 * Task history. Each entry is an `audit_logs` row whose `metadata` JSON carries the task ID and,
 * since entries started recording what changed, a small `details` object: the fields one save
 * changed with their old and new values, who a new task went to, or a deleted task's title.
 * Entries written before that have no `details` and are described from their action alone.
 */

/** The fields of a task that history describes, before or after a change. */
export type TaskActivityState = {
	title: string;
	description: string;
	dueAt: Date | null;
	allDay: boolean;
	timezone: string;
	priority: CalendarPriority;
	recurrenceRule: string | null;
	mailboxId: string | null;
	assignee: TaskActivityPerson | null;
};

const PRIORITIES = new Set<CalendarPriority>(["none", "low", "medium", "high"]);
const CHANNELS = new Set<CalendarReminderChannel>(["in_app", "email"]);
const ACTIONS = new Set<CalendarTaskActivityAction>([
	"created",
	"updated",
	"reassigned",
	"completed",
	"reopened",
	"deleted",
]);

/** The audit row for one task history entry. */
export function taskActivityRow(input: {
	actorUserId: string;
	targetUserId: string;
	action: `calendar.task_${CalendarTaskActivityAction}`;
	taskId: string;
	metadata?: Record<string, string>;
	details?: TaskActivityDetails | null;
}) {
	const details = compactDetails(input.details);
	return {
		id: newId("aud"),
		actorUserId: input.actorUserId,
		targetUserId: input.targetUserId,
		action: input.action,
		metadata: JSON.stringify({
			taskId: input.taskId,
			...input.metadata,
			...(details ? { details } : {}),
		}),
	};
}

function compactDetails(
	details: TaskActivityDetails | null | undefined,
): TaskActivityDetails | null {
	if (!details) return null;
	const compact: TaskActivityDetails = {};
	if (details.changes?.length) compact.changes = details.changes;
	if (details.assignee) compact.assignee = details.assignee;
	if (details.nextOccurrence) compact.nextOccurrence = true;
	if (details.title) compact.title = details.title;
	return Object.keys(compact).length > 0 ? compact : null;
}

export function dueSnapshot(
	dueAt: Date | null,
	allDay: boolean,
	timezone: string,
): TaskActivityDue | null {
	return dueAt ? { at: dueAt.toISOString(), allDay, timezone } : null;
}

/** All-day dates ignore the timezone; a timed due date reads differently in another zone. */
function sameDue(a: TaskActivityDue | null, b: TaskActivityDue | null): boolean {
	if (!a || !b) return a === b;
	if (a.at !== b.at || a.allDay !== b.allDay) return false;
	return a.allDay || a.timezone === b.timezone;
}

/** Every field that differs between two states, in the order history lists them. */
export function collectTaskChanges(
	before: TaskActivityState,
	after: TaskActivityState,
): TaskActivityChange[] {
	const changes: TaskActivityChange[] = [];
	if (before.title !== after.title) {
		changes.push({ field: "title", from: before.title, to: after.title });
	}
	if (after.assignee && before.assignee?.id !== after.assignee.id) {
		changes.push({ field: "assignee", from: before.assignee, to: after.assignee });
	}
	const fromDue = dueSnapshot(before.dueAt, before.allDay, before.timezone);
	const toDue = dueSnapshot(after.dueAt, after.allDay, after.timezone);
	if (!sameDue(fromDue, toDue)) changes.push({ field: "due", from: fromDue, to: toDue });
	if ((before.recurrenceRule ?? null) !== (after.recurrenceRule ?? null)) {
		changes.push({
			field: "repeat",
			from: before.recurrenceRule ?? null,
			to: after.recurrenceRule ?? null,
		});
	}
	if (before.priority !== after.priority) {
		changes.push({ field: "priority", from: before.priority, to: after.priority });
	}
	if (before.description !== after.description) {
		const had = before.description.trim() !== "";
		const has = after.description.trim() !== "";
		if (had || has) {
			changes.push({
				field: "description",
				change: !had ? "added" : has ? "edited" : "removed",
			});
		}
	}
	if ((before.mailboxId ?? null) !== (after.mailboxId ?? null)) changes.push({ field: "mailbox" });
	return changes;
}

/** A reminder on a task was added, removed, or moved; the reminder's owner is the actor. */
export function reminderActivityRow(input: {
	actorUserId: string;
	taskId: string;
	from: Date | null;
	to: Date | null;
	timezone: string;
	channel: CalendarReminderChannel;
}) {
	return taskActivityRow({
		actorUserId: input.actorUserId,
		targetUserId: input.actorUserId,
		action: "calendar.task_updated",
		taskId: input.taskId,
		details: {
			changes: [
				{
					field: "reminder",
					from: input.from?.toISOString() ?? null,
					to: input.to?.toISOString() ?? null,
					timezone: input.timezone,
					channel: input.channel,
				},
			],
		},
	});
}

export function parseTaskActivityAction(action: string): CalendarTaskActivityAction | null {
	const name = action.replace(/^calendar\.task_/, "");
	return ACTIONS.has(name as CalendarTaskActivityAction)
		? (name as CalendarTaskActivityAction)
		: null;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
	typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isInstant = (value: unknown): value is string =>
	isString(value) && !Number.isNaN(Date.parse(value));

function parsePerson(value: unknown): TaskActivityPerson | null {
	if (!isObject(value) || !isString(value.id) || !value.id) return null;
	return { id: value.id, name: isString(value.name) ? value.name : null };
}

function parseDue(value: unknown): TaskActivityDue | null {
	if (!isObject(value) || !isInstant(value.at) || !isString(value.timezone)) return null;
	return { at: value.at, allDay: value.allDay === true, timezone: value.timezone };
}

const nullable = <T>(value: unknown, parse: (value: unknown) => T | null): T | null | undefined =>
	value === null ? null : (parse(value) ?? undefined);

function parseChange(value: unknown): TaskActivityChange | null {
	if (!isObject(value)) return null;
	switch (value.field) {
		case "title":
			return isString(value.from) && isString(value.to)
				? { field: "title", from: value.from, to: value.to }
				: null;
		case "description":
			return value.change === "added" || value.change === "edited" || value.change === "removed"
				? { field: "description", change: value.change }
				: null;
		case "due": {
			const from = nullable(value.from, parseDue);
			const to = nullable(value.to, parseDue);
			return from === undefined || to === undefined || (!from && !to)
				? null
				: { field: "due", from, to };
		}
		case "priority":
			return PRIORITIES.has(value.from as CalendarPriority) &&
				PRIORITIES.has(value.to as CalendarPriority)
				? {
						field: "priority",
						from: value.from as CalendarPriority,
						to: value.to as CalendarPriority,
					}
				: null;
		case "assignee": {
			const from = nullable(value.from, parsePerson);
			const to = parsePerson(value.to);
			return from === undefined || !to ? null : { field: "assignee", from, to };
		}
		case "repeat": {
			const from = value.from === null || isString(value.from) ? value.from : undefined;
			const to = value.to === null || isString(value.to) ? value.to : undefined;
			return from === undefined || to === undefined || (!from && !to)
				? null
				: { field: "repeat", from, to };
		}
		case "reminder": {
			const from = value.from === null || isInstant(value.from) ? value.from : undefined;
			const to = value.to === null || isInstant(value.to) ? value.to : undefined;
			if (from === undefined || to === undefined || (!from && !to)) return null;
			if (!isString(value.timezone) || !CHANNELS.has(value.channel as CalendarReminderChannel)) {
				return null;
			}
			return {
				field: "reminder",
				from,
				to,
				timezone: value.timezone,
				channel: value.channel as CalendarReminderChannel,
			};
		}
		case "mailbox":
			return { field: "mailbox" };
		default:
			return null;
	}
}

/**
 * Reads an entry's stored metadata into display details, dropping anything malformed. Entries
 * from before details were stored still name the people involved: who a new task went to,
 * and who a reassignment moved it between.
 */
export function readTaskActivityDetails(
	metadata: string | null,
	action: CalendarTaskActivityAction,
	actorUserId: string | null,
): TaskActivityDetails | null {
	let parsed: unknown;
	try {
		parsed = metadata ? JSON.parse(metadata) : null;
	} catch {
		parsed = null;
	}
	const stored = isObject(parsed) ? parsed : {};
	const raw = isObject(stored.details) ? stored.details : {};
	const details: TaskActivityDetails = {};

	const changes = Array.isArray(raw.changes)
		? raw.changes.map(parseChange).filter((change) => change !== null)
		: [];
	if (changes.length > 0) details.changes = changes;
	const assignee = parsePerson(raw.assignee);
	if (assignee) details.assignee = assignee;
	if (isString(raw.title) && raw.title) details.title = raw.title;

	if (action === "created" && isString(stored.previousTaskId)) details.nextOccurrence = true;
	if (!isObject(stored.details)) {
		const legacyAssignee = isString(stored.assigneeUserId) ? stored.assigneeUserId : null;
		const legacyPrevious = isString(stored.previousAssigneeUserId)
			? stored.previousAssigneeUserId
			: null;
		if (action === "created" && legacyAssignee && legacyAssignee !== actorUserId) {
			details.assignee = { id: legacyAssignee, name: null };
		}
		if (action === "reassigned" && legacyAssignee && legacyAssignee !== legacyPrevious) {
			details.changes = [
				{
					field: "assignee",
					from: legacyPrevious ? { id: legacyPrevious, name: null } : null,
					to: { id: legacyAssignee, name: null },
				},
			];
		}
	}
	return compactDetails(details);
}

/** Account IDs an entry names, so current names can be looked up in one query. */
export function taskActivityPersonIds(details: TaskActivityDetails | null): string[] {
	if (!details) return [];
	const ids = details.assignee ? [details.assignee.id] : [];
	for (const change of details.changes ?? []) {
		if (change.field !== "assignee") continue;
		if (change.from) ids.push(change.from.id);
		ids.push(change.to.id);
	}
	return ids;
}

/** Uses each account's current name, keeping the recorded one for removed accounts. */
export function withCurrentNames(
	details: TaskActivityDetails | null,
	names: ReadonlyMap<string, string>,
): TaskActivityDetails | null {
	if (!details) return null;
	const person = (value: TaskActivityPerson): TaskActivityPerson => ({
		id: value.id,
		name: names.get(value.id) ?? value.name,
	});
	return {
		...details,
		...(details.assignee ? { assignee: person(details.assignee) } : {}),
		...(details.changes
			? {
					changes: details.changes.map((change) =>
						change.field === "assignee"
							? { ...change, from: change.from ? person(change.from) : null, to: person(change.to) }
							: change,
					),
				}
			: {}),
	};
}
