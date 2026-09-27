"use client";

import { Circle, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CalendarEventRecord, CalendarTaskRecord } from "@/lib/calendar/types";
import { dateKey, eventDayKeys, formatTime, isMultiDayTimed } from "@/lib/calendar/wall-clock";
import type { CalendarGridProps } from "./calendar-types";
import { defaultEventStart, getTaskTone, taskDueKey, type TaskTone } from "./calendar-utils";

const MAX_VISIBLE_ITEMS = 3;

type DayItem =
	| { kind: "banner"; event: CalendarEventRecord }
	| { kind: "timed"; event: CalendarEventRecord }
	| { kind: "task"; task: CalendarTaskRecord };

const TASK_ITEM_TONES: Record<TaskTone, string> = {
	completed: "text-neutral-400 line-through",
	overdue: "text-red-700",
	open: "text-neutral-700",
};

function dayNumberClass(isToday: boolean, inMonth: boolean): string {
	if (isToday) return "bg-primary text-primary-foreground";
	return inMonth
		? "text-neutral-800 hover:bg-neutral-100"
		: "text-neutral-400 hover:bg-neutral-100";
}

function MonthDayItemButton({
	item,
	onSelectEvent,
	onSelectTask,
}: Readonly<{
	item: DayItem;
	onSelectEvent: CalendarGridProps["onSelectEvent"];
	onSelectTask: CalendarGridProps["onSelectTask"];
}>) {
	if (item.kind === "task") {
		const completed = item.task.status === "completed";
		return (
			<button
				type="button"
				onClick={() => onSelectTask(item.task)}
				className={cn(
					"relative flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-primary/40",
					TASK_ITEM_TONES[getTaskTone(item.task)],
				)}
			>
				{completed ? (
					<CircleCheck className="size-3 shrink-0" />
				) : (
					<Circle className="size-3 shrink-0" />
				)}
				<span className="truncate">{item.task.title}</span>
			</button>
		);
	}
	if (item.kind === "banner") {
		return (
			<button
				type="button"
				onClick={() => onSelectEvent(item.event)}
				className="relative w-full min-w-0 truncate rounded-md bg-primary/90 px-1.5 py-0.5 text-left text-xs font-medium text-primary-foreground hover:bg-primary focus-visible:ring-2 focus-visible:ring-primary/60"
			>
				{item.event.title}
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={() => onSelectEvent(item.event)}
			className="relative flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-neutral-800 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-primary/40"
		>
			<span className="size-1.5 shrink-0 rounded-full bg-primary" />
			<span className="shrink-0 text-neutral-500 tabular-nums">
				{formatTime(item.event.startsAt)}
			</span>
			<span className="truncate font-medium">{item.event.title}</span>
		</button>
	);
}

export function MonthView({
	days,
	anchor,
	events,
	tasks,
	onSelectEvent,
	onSelectTask,
	onCreateEvent,
	onOpenDay,
}: Readonly<CalendarGridProps>) {
	const today = dateKey(new Date());
	const itemsByDay = new Map<string, DayItem[]>();
	const push = (key: string, item: DayItem) => {
		const list = itemsByDay.get(key) ?? [];
		list.push(item);
		itemsByDay.set(key, list);
	};
	for (const event of events) {
		const banner = event.allDay || isMultiDayTimed(event);
		for (const key of eventDayKeys(event)) {
			push(key, banner ? { kind: "banner", event } : { kind: "timed", event });
		}
	}
	for (const task of tasks) {
		const key = taskDueKey(task);
		if (key) push(key, { kind: "task", task });
	}
	const order = { banner: 0, timed: 1, task: 2 };
	const weeks = days.length / 7;

	return (
		<div className="flex h-full min-h-144 flex-col">
			<div className="grid shrink-0 grid-cols-7 border-b border-neutral-200">
				{days.slice(0, 7).map((day) => (
					<div
						key={day.getDay()}
						className="px-2 py-2 text-center text-[11px] font-medium tracking-wide text-neutral-500 uppercase"
					>
						{day.toLocaleDateString(undefined, { weekday: "short" })}
					</div>
				))}
			</div>
			<div
				className="grid flex-1 grid-cols-7"
				style={{ gridTemplateRows: `repeat(${weeks}, minmax(6.5rem, 1fr))` }}
			>
				{days.map((day) => {
					const key = dateKey(day);
					const inMonth = day.getMonth() === anchor.getMonth();
					const items = (itemsByDay.get(key) ?? []).sort(
						(a, b) =>
							order[a.kind] - order[b.kind] ||
							("event" in a && "event" in b ? a.event.startsAt.localeCompare(b.event.startsAt) : 0),
					);
					const visible = items.slice(0, MAX_VISIBLE_ITEMS);
					const hidden = items.length - visible.length;
					return (
						<div
							key={key}
							className={cn(
								"group relative flex min-w-0 flex-col gap-0.5 border-r border-b border-neutral-100 px-1 pt-1 pb-1.5 nth-[7n]:border-r-0",
								!inMonth && "bg-neutral-50/70",
							)}
						>
							{/* Sits behind the day's content, so empty space creates an event by pointer or keyboard. */}
							<button
								type="button"
								aria-label={`Create event on ${day.toLocaleDateString(undefined, { dateStyle: "full" })}`}
								className="absolute inset-0 cursor-default outline-none focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-inset"
								onClick={() => {
									const start = defaultEventStart(day);
									onCreateEvent({
										start,
										end: new Date(start.getTime() + 3_600_000),
										allDay: false,
									});
								}}
							/>
							<button
								type="button"
								onClick={() => onOpenDay(day)}
								aria-label={day.toLocaleDateString(undefined, { dateStyle: "full" })}
								className={cn(
									"relative mx-auto mb-0.5 flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
									dayNumberClass(key === today, inMonth),
								)}
							>
								{day.getDate() === 1
									? day.toLocaleDateString(undefined, { month: "short", day: "numeric" })
									: day.getDate()}
							</button>
							{visible.map((item) => (
								<MonthDayItemButton
									key={
										item.kind === "task" ? `task-${item.task.id}` : `${item.kind}-${item.event.id}`
									}
									item={item}
									onSelectEvent={onSelectEvent}
									onSelectTask={onSelectTask}
								/>
							))}
							{hidden > 0 && (
								<button
									type="button"
									onClick={() => onOpenDay(day)}
									className="relative w-full rounded-md px-1.5 py-0.5 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-primary/40"
								>
									{hidden} more
								</button>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
