"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, CircleCheck, Repeat } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { CalendarEventRecord, CalendarTaskRecord } from "@/lib/calendar/types";
import {
	MINUTES_PER_DAY,
	capTimedColumns,
	dateKey,
	eventDayKeys,
	formatTime,
	isMultiDayTimed,
	layoutTimedEvents,
	type TimedOverflow,
} from "@/lib/calendar/wall-clock";
import type { CalendarGridProps } from "./calendar-types";
import { defaultEventStart, getTaskTone, taskDueKey, type TaskTone } from "./calendar-utils";
import { TASK_SLOT_MINUTES, ownerTint, taskTimedSpan } from "./calendar-grid-utils";

const HOUR_HEIGHT = 48;
const SLOT_MINUTES = 30;
/** Side-by-side columns a crowded slot may use on shared calendars before "+N" takes over. */
const SHARED_MAX_COLUMNS = { day: 5, week: 2 };

type GridEntry = { id: string; startsAt: string; endsAt: string } & (
	{ kind: "event"; event: CalendarEventRecord } | { kind: "task"; task: CalendarTaskRecord }
);

type EntryHandlers = Pick<CalendarGridProps, "onSelectEvent" | "onSelectTask" | "owners">;

const TASK_CHIP_TONES: Record<TaskTone, string> = {
	completed: "text-neutral-400 line-through",
	overdue: "border-red-200 text-red-700",
	open: "text-neutral-700",
};

/** The half-hour slot under a pointer position within a day column. */
function slotStart(day: Date, offsetY: number): Date {
	const minutes = Math.floor((offsetY / HOUR_HEIGHT) * (60 / SLOT_MINUTES)) * SLOT_MINUTES;
	const start = new Date(day);
	start.setHours(0, Math.min(Math.max(minutes, 0), MINUTES_PER_DAY - SLOT_MINUTES));
	return start;
}

export function TimeGridView({
	days,
	events,
	tasks,
	onSelectEvent,
	onSelectTask,
	onCreateEvent,
	onOpenDay,
	owners,
}: Readonly<CalendarGridProps>) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const now = useNow();
	const today = dateKey(now);
	const keys = days.map(dateKey);
	const bannerEvents = events.filter((event) => event.allDay || isMultiDayTimed(event));
	const timedEvents = events.filter((event) => !event.allDay && !isMultiDayTimed(event));
	// Shared calendars place timed tasks in the hour grid, where their times tell people apart.
	const gridTasks = owners ? tasks.filter((task) => !task.allDay && task.dueAt) : [];
	const rowTasks = owners ? tasks.filter((task) => task.allDay) : tasks;
	const entries: GridEntry[] = [
		...timedEvents.map((event) => ({ ...event, kind: "event" as const, event })),
		...gridTasks.flatMap((task) => {
			const span = taskTimedSpan(task);
			return span ? [{ id: task.id, ...span, kind: "task" as const, task }] : [];
		}),
	];
	const maxColumns = owners
		? SHARED_MAX_COLUMNS[days.length === 1 ? "day" : "week"]
		: Number.POSITIVE_INFINITY;
	const handlers: EntryHandlers = { onSelectEvent, onSelectTask, owners };
	const columns = `3.5rem repeat(${days.length}, minmax(0, 1fr))`;

	const firstKey = keys[0];
	const containsToday = keys.includes(today);
	useEffect(() => {
		// Scroll once per visible range; scrolling afterwards belongs to the user.
		const container = scrollRef.current;
		if (!container) return;
		const hour = containsToday ? Math.max(new Date().getHours() - 2, 0) : 8;
		container.scrollTop = hour * HOUR_HEIGHT;
	}, [firstKey, containsToday]);

	return (
		<div className="flex h-full min-h-144 flex-col">
			<div
				className="grid shrink-0 border-b border-neutral-200"
				style={{ gridTemplateColumns: columns }}
			>
				<div />
				{days.map((day, index) => (
					<button
						key={keys[index]}
						type="button"
						onClick={() => onOpenDay(day)}
						className="flex flex-col items-center gap-0.5 py-2 hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40"
					>
						<span
							className={cn(
								"text-[11px] font-medium tracking-wide uppercase max-sm:text-[10px] max-sm:tracking-normal",
								keys[index] === today ? "text-primary" : "text-neutral-500",
							)}
						>
							{day.toLocaleDateString(undefined, { weekday: "short" })}
						</span>
						<span
							className={cn(
								"flex size-9 items-center justify-center rounded-full text-lg max-sm:size-7 max-sm:text-base",
								keys[index] === today ? "bg-primary text-primary-foreground" : "text-neutral-800",
							)}
						>
							{day.getDate()}
						</span>
					</button>
				))}
			</div>

			<div
				className="grid max-h-36 shrink-0 overflow-y-auto border-b border-neutral-200"
				style={{ gridTemplateColumns: columns }}
			>
				<div className="px-1 pt-1.5 text-right text-[10px] text-neutral-400">All day</div>
				{keys.map((key) => {
					const banners = bannerEvents.filter((event) => eventDayKeys(event).includes(key));
					const dayTasks = rowTasks.filter((task) => taskDueKey(task) === key);
					return (
						<div
							key={key}
							className="flex min-h-8 min-w-0 flex-col gap-0.5 border-l border-neutral-100 p-1"
						>
							{banners.map((event) => {
								const owner = owners?.event(event);
								return (
									<button
										key={event.id}
										type="button"
										onClick={() => onSelectEvent(event)}
										title={owner ? `${owner.name}: ${event.title}` : undefined}
										style={owner ? ownerTint(owner.color, true) : undefined}
										className={cn(
											"w-full truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary/60",
											owner
												? "text-neutral-900 hover:brightness-95"
												: "bg-primary/90 text-primary-foreground hover:bg-primary",
										)}
									>
										{event.title}
										{owner && <span className="sr-only">, {owner.name}</span>}
									</button>
								);
							})}
							{dayTasks.map((task) => {
								const owner = owners?.task(task);
								const Icon = task.status === "completed" ? CircleCheck : Circle;
								return (
									<button
										key={task.id}
										type="button"
										onClick={() => onSelectTask(task)}
										title={owner ? `${owner.name}: ${task.title}` : undefined}
										className={cn(
											"flex w-full min-w-0 items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-left text-xs hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-primary/40",
											TASK_CHIP_TONES[getTaskTone(task, now)],
											owner?.upcoming && "border-dashed opacity-70",
										)}
									>
										<Icon
											className="size-3 shrink-0"
											style={owner ? { color: owner.color } : undefined}
										/>
										{!task.allDay && task.dueAt && (
											<span className="shrink-0 tabular-nums text-neutral-500">
												{formatTime(task.dueAt)}
											</span>
										)}
										<span className="truncate">{task.title}</span>
										{owner && <span className="sr-only">, {owner.name}</span>}
									</button>
								);
							})}
						</div>
					);
				})}
			</div>

			<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				<div className="relative grid" style={{ gridTemplateColumns: columns }}>
					<div className="relative" style={{ height: 24 * HOUR_HEIGHT }}>
						{Array.from({ length: 23 }, (_, index) => (
							<span
								key={index}
								className="absolute right-2 -translate-y-1/2 text-[10px] text-neutral-400 tabular-nums"
								style={{ top: (index + 1) * HOUR_HEIGHT }}
							>
								{new Date(2000, 0, 1, index + 1).toLocaleTimeString(undefined, { hour: "numeric" })}
							</span>
						))}
					</div>
					{days.map((day, index) => {
						const { blocks, overflow } = capTimedColumns(
							layoutTimedEvents(entries, day, owners ? TASK_SLOT_MINUTES : undefined),
							maxColumns,
						);
						const isToday = keys[index] === today;
						const nowMinute = now.getHours() * 60 + now.getMinutes();
						return (
							<div
								key={keys[index]}
								className="relative border-l border-neutral-100"
								style={{
									height: 24 * HOUR_HEIGHT,
									backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_HEIGHT - 1}px, var(--color-neutral-100) ${HOUR_HEIGHT - 1}px, var(--color-neutral-100) ${HOUR_HEIGHT}px)`,
								}}
							>
								{/* Sits behind the events, so empty time creates an event by pointer or keyboard. */}
								{onCreateEvent && (
									<button
										type="button"
										aria-label={`Create event on ${day.toLocaleDateString(undefined, { dateStyle: "full" })}`}
										className="absolute inset-0 cursor-default outline-none focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-inset"
										onClick={(event) => {
											// A keyboard activation has no pointer position (detail is 0).
											const start =
												event.detail === 0
													? defaultEventStart(day)
													: slotStart(day, event.nativeEvent.offsetY);
											onCreateEvent({
												start,
												end: new Date(start.getTime() + 3_600_000),
												allDay: false,
											});
										}}
									/>
								)}
								{blocks.map(({ item, startMinute, endMinute, column, columns: count }) => (
									<GridBlock
										key={item.id}
										entry={item}
										startMinute={startMinute}
										endMinute={endMinute}
										column={column}
										columns={count}
										handlers={handlers}
									/>
								))}
								{overflow.map((group) => (
									<OverflowBlock
										key={`overflow-${group.startMinute}-${group.items[0].id}`}
										group={group}
										day={day}
										handlers={handlers}
									/>
								))}
								{isToday && (
									<div
										className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
										style={{ top: (nowMinute / 60) * HOUR_HEIGHT }}
									>
										<span className="-ml-1.5 size-3 rounded-full bg-red-500" />
										<span className="h-0.5 flex-1 bg-red-500" />
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

function blockPosition(startMinute: number, endMinute: number, column: number, columns: number) {
	return {
		top: (startMinute / 60) * HOUR_HEIGHT,
		height: ((endMinute - startMinute) / 60) * HOUR_HEIGHT,
		left: `calc(${(column / columns) * 100}% + 2px)`,
		width: `calc(${100 / columns}% - 4px)`,
	};
}

function GridBlock({
	entry,
	startMinute,
	endMinute,
	column,
	columns,
	handlers: { onSelectEvent, onSelectTask, owners },
}: Readonly<{
	entry: GridEntry;
	startMinute: number;
	endMinute: number;
	column: number;
	columns: number;
	handlers: EntryHandlers;
}>) {
	const position = blockPosition(startMinute, endMinute, column, columns);
	if (entry.kind === "event") {
		const { event } = entry;
		const owner = owners?.event(event);
		const time = `${formatTime(event.startsAt)} – ${formatTime(event.endsAt)}`;
		return (
			<button
				type="button"
				onClick={() => onSelectEvent(event)}
				title={owner ? `${owner.name}: ${event.title}, ${time}` : undefined}
				className={cn(
					"absolute overflow-hidden rounded-md border border-white px-1.5 py-0.5 text-left text-xs focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-primary/60 max-sm:px-0.5 max-sm:text-[10px]",
					owner
						? "text-neutral-900 hover:z-10 hover:brightness-95"
						: "bg-primary/12 text-primary shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary/20",
				)}
				style={{ ...position, ...(owner ? ownerTint(owner.color, true) : {}) }}
			>
				<span className="block truncate font-semibold">{event.title}</span>
				{position.height >= 34 && (
					<span
						className={cn(
							"block truncate tabular-nums",
							owner ? "text-neutral-600" : "text-primary/80",
						)}
					>
						{time}
					</span>
				)}
				{owner ? (
					position.height >= 56 ? (
						<span className="block truncate text-neutral-600">{owner.name}</span>
					) : (
						<span className="sr-only">, {owner.name}</span>
					)
				) : (
					position.height >= 56 &&
					event.location && <span className="block truncate text-primary/70">{event.location}</span>
				)}
			</button>
		);
	}
	const { task } = entry;
	const owner = owners?.task(task);
	const completed = task.status === "completed";
	const Icon = completed ? CircleCheck : Circle;
	return (
		<button
			type="button"
			onClick={() => onSelectTask(task)}
			title={owner ? `${owner.name}: ${task.title}, due ${formatTime(entry.startsAt)}` : undefined}
			className={cn(
				"absolute flex items-center gap-1 overflow-hidden rounded-md border bg-white px-1.5 text-left text-xs text-neutral-900 hover:z-10 hover:brightness-95 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-primary/60",
				completed && "text-neutral-500 line-through opacity-70",
				owner?.upcoming && "border-dashed opacity-75",
			)}
			style={{ ...position, ...(owner ? ownerTint(owner.color, true) : {}) }}
		>
			<Icon className="size-3 shrink-0" style={owner ? { color: owner.color } : undefined} />
			<span className="min-w-0 truncate font-medium">{task.title}</span>
			{owner?.upcoming && (
				<Repeat aria-label="Upcoming repeat" className="size-3 shrink-0 text-neutral-500" />
			)}
			{owner && <span className="sr-only">, {owner.name}</span>}
		</button>
	);
}

function entryOwner(entry: GridEntry, owners: CalendarGridProps["owners"]) {
	return entry.kind === "event" ? owners?.event(entry.event) : owners?.task(entry.task);
}

/** The items that don't fit beside the others in a crowded slot, one click away. */
function OverflowBlock({
	group,
	day,
	handlers,
}: Readonly<{ group: TimedOverflow<GridEntry>; day: Date; handlers: EntryHandlers }>) {
	const [open, setOpen] = useState(false);
	const position = blockPosition(group.startMinute, group.endMinute, group.column, group.columns);
	const start = new Date(day);
	start.setHours(0, group.startMinute);
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label={`${group.items.length} more at ${formatTime(start)}`}
				className="absolute flex items-start justify-center overflow-hidden rounded-md border border-neutral-200 bg-neutral-100 px-1 py-0.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-primary/60"
				style={position}
			>
				+{group.items.length}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 max-w-[calc(100vw-1rem)] gap-2 p-3">
				<PopoverTitle className="px-1 text-sm text-neutral-900">
					{day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })},
					from {formatTime(start)}
				</PopoverTitle>
				<div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto overscroll-contain">
					{group.items.map((entry) => {
						const owner = entryOwner(entry, handlers.owners);
						const title = entry.kind === "event" ? entry.event.title : entry.task.title;
						return (
							<button
								key={`${entry.kind}-${entry.id}`}
								type="button"
								onClick={() => {
									setOpen(false);
									if (entry.kind === "event") handlers.onSelectEvent(entry.event);
									else handlers.onSelectTask(entry.task);
								}}
								className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-primary/40"
							>
								<span
									className="size-2 shrink-0 rounded-full bg-primary"
									style={owner ? { backgroundColor: owner.color } : undefined}
								/>
								<span className="shrink-0 text-neutral-500 tabular-nums">
									{formatTime(entry.startsAt)}
								</span>
								<span className="min-w-0 flex-1 truncate font-medium text-neutral-900">
									{title}
								</span>
								{owner && (
									<span className="max-w-24 shrink-0 truncate text-neutral-500">{owner.name}</span>
								)}
							</button>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}

function useNow(intervalMs = 60_000): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}
