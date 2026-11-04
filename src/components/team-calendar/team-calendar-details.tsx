"use client";

import type { ReactNode } from "react";
import { CalendarClock, Circle, CircleCheck, Flag, Repeat } from "lucide-react";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	PRIORITY_OPTIONS,
	PRIORITY_STYLES,
	getTaskTone,
} from "@/components/calendar/calendar-utils";
import { parseEventAttendees } from "@/lib/calendar/client";
import { describeRecurrenceRule } from "@/lib/calendar/recurrence";
import {
	browserTimezone,
	formatDateKey,
	formatDateTime,
	formatEventWhen,
	utcDateKey,
} from "@/lib/calendar/wall-clock";
import type {
	TeamCalendarEvent,
	TeamCalendarPerson,
	TeamCalendarTask,
} from "@/lib/team-calendar/types";
import { cn } from "@/lib/utils";
import { personInitials } from "./team-calendar-utils";

export type TeamCalendarSelection =
	{ kind: "task"; task: TeamCalendarTask } | { kind: "event"; event: TeamCalendarEvent };

type PersonLookup = (id: string) => { person?: TeamCalendarPerson; color: string };

const STATUS_LABELS = { open: "Open", overdue: "Overdue", completed: "Completed" };
const STATUS_STYLES = {
	open: "bg-sky-50 text-sky-700",
	overdue: "bg-red-50 text-red-700",
	completed: "bg-emerald-50 text-emerald-700",
};

function Row({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
	return (
		<div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-2">
			<dt className="text-neutral-500">{label}</dt>
			<dd className="min-w-0 break-words text-neutral-900">{children}</dd>
		</div>
	);
}

function Person({ id, lookup }: Readonly<{ id: string; lookup: PersonLookup }>) {
	const { person, color } = lookup(id);
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span
				aria-hidden="true"
				className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
				style={{ backgroundColor: color }}
			>
				{personInitials(person?.name ?? "", person?.email)}
			</span>
			<span className="min-w-0">
				<span className="block truncate">{person?.name || person?.email || "Unknown person"}</span>
				{person?.email && person.name && (
					<span className="block truncate text-xs text-neutral-500">{person.email}</span>
				)}
			</span>
		</span>
	);
}

function taskDue(task: TeamCalendarTask): string {
	if (!task.dueAt) return "No due date";
	if (task.allDay)
		return `${formatDateKey(utcDateKey(task.dueAt), { weekday: "long", year: "numeric" })} · All day`;
	const local = formatDateTime(task.dueAt);
	return task.timezone && task.timezone !== browserTimezone()
		? `${local} (${formatDateTime(task.dueAt, task.timezone)} ${task.timezone})`
		: local;
}

function TaskDetails({ task, lookup }: Readonly<{ task: TeamCalendarTask; lookup: PersonLookup }>) {
	const tone = getTaskTone(task);
	const repeat = describeRecurrenceRule(task.recurrenceRule);
	const priority = PRIORITY_OPTIONS.find((option) => option.value === task.priority);
	return (
		<dl className="divide-y divide-neutral-100">
			<Row label="Assigned to">
				<Person id={task.assigneeUserId} lookup={lookup} />
			</Row>
			{task.creatorUserId !== task.assigneeUserId && (
				<Row label="Created by">
					<Person id={task.creatorUserId} lookup={lookup} />
				</Row>
			)}
			<Row label="Due">{taskDue(task)}</Row>
			<Row label="Status">
				<span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", STATUS_STYLES[tone])}>
					{task.upcoming ? "Upcoming" : STATUS_LABELS[tone]}
				</span>
				{task.completedAt && (
					<span className="ml-2 text-xs text-neutral-500">{formatDateTime(task.completedAt)}</span>
				)}
			</Row>
			<Row label="Priority">
				<span className="inline-flex items-center gap-1.5">
					<Flag className={cn("size-4", PRIORITY_STYLES[task.priority])} />
					{priority?.label ?? "No priority"}
				</span>
			</Row>
			<Row label="Repeats">
				{repeat ? (
					<span className="inline-flex items-start gap-1.5">
						<Repeat className="mt-0.5 size-4 shrink-0 text-neutral-500" />
						<span>
							{repeat}
							{task.upcoming && (
								<span className="block text-xs text-neutral-500">
									This occurrence is created when the one before it is completed.
								</span>
							)}
						</span>
					</span>
				) : (
					"Doesn’t repeat"
				)}
			</Row>
			<Row label="Notes">
				{task.description ? (
					<span className="whitespace-pre-wrap">{task.description}</span>
				) : (
					<span className="text-neutral-400">No notes</span>
				)}
			</Row>
		</dl>
	);
}

function EventDetails({
	event,
	lookup,
}: Readonly<{ event: TeamCalendarEvent; lookup: PersonLookup }>) {
	const attendees = parseEventAttendees(event);
	return (
		<dl className="divide-y divide-neutral-100">
			<Row label="Calendar of">
				<Person id={event.ownerUserId} lookup={lookup} />
			</Row>
			<Row label="When">{formatEventWhen(event)}</Row>
			{event.location && <Row label="Location">{event.location}</Row>}
			{(event.organizer || event.importOrganizer) && (
				<Row label="Organizer">{event.organizer || event.importOrganizer}</Row>
			)}
			{attendees.length > 0 && (
				<Row label="Guests">
					<ul className="space-y-0.5">
						{attendees.map((address) => (
							<li key={address} className="truncate">
								{address}
							</li>
						))}
					</ul>
				</Row>
			)}
			<Row label="Notes">
				{event.description ? (
					<span className="whitespace-pre-wrap">{event.description}</span>
				) : (
					<span className="text-neutral-400">No notes</span>
				)}
			</Row>
		</dl>
	);
}

/** Read-only details of a team member's task or event. */
export function TeamCalendarDetails({
	selection,
	open,
	onOpenChange,
	lookup,
}: Readonly<{
	selection: TeamCalendarSelection | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	lookup: PersonLookup;
}>) {
	const ownerId =
		selection?.kind === "task" ? selection.task.assigneeUserId : selection?.event.ownerUserId;
	const color = ownerId ? lookup(ownerId).color : undefined;
	const title = selection?.kind === "task" ? selection.task.title : selection?.event.title;
	const completed = selection?.kind === "task" && selection.task.status === "completed";
	const Icon = selection?.kind === "event" ? CalendarClock : completed ? CircleCheck : Circle;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle className="flex items-start gap-2 text-lg leading-snug">
						<Icon className="mt-0.5 size-5 shrink-0" style={{ color }} />
						<span className={cn("min-w-0 break-words", completed && "line-through")}>{title}</span>
					</DialogTitle>
					<p className="text-xs text-neutral-500">
						{selection?.kind === "event" ? "Event" : "Task"} · view only
					</p>
				</DialogHeader>
				<DialogBody>
					{selection?.kind === "task" && <TaskDetails task={selection.task} lookup={lookup} />}
					{selection?.kind === "event" && <EventDetails event={selection.event} lookup={lookup} />}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
