"use client";

import { useState } from "react";
import { Circle, CircleCheck, Repeat } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { dateKey, formatTime } from "@/lib/calendar/wall-clock";
import type { CalendarGridProps } from "./calendar-types";
import { defaultEventStart, getTaskTone, type TaskTone } from "./calendar-utils";
import {
	dayItemKey,
	monthDayItems,
	ownerTint,
	splitDayItems,
	type DayItem,
} from "./calendar-grid-utils";

/** Rows a day cell holds, the "+N more" control included. */
const DAY_ROWS = 4;

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

type ItemHandlers = Pick<CalendarGridProps, "onSelectEvent" | "onSelectTask" | "owners">;

function MonthDayItemButton({
	item,
	onSelectEvent,
	onSelectTask,
	owners,
}: Readonly<ItemHandlers & { item: DayItem }>) {
	if (item.kind === "task") {
		const completed = item.task.status === "completed";
		const owner = owners?.task(item.task);
		const Icon = completed ? CircleCheck : Circle;
		return (
			<button
				type="button"
				onClick={() => onSelectTask(item.task)}
				title={owner ? `${owner.name}: ${item.task.title}` : undefined}
				className={cn(
					"relative flex w-full min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-left text-xs hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-primary/40 max-sm:gap-0.5 max-sm:px-0.5 max-sm:text-[11px]",
					TASK_ITEM_TONES[getTaskTone(item.task)],
					owner?.upcoming && "opacity-70",
				)}
			>
				<Icon className="size-3 shrink-0" style={owner ? { color: owner.color } : undefined} />
				{owner && !item.task.allDay && item.task.dueAt && (
					<span className="shrink-0 text-neutral-500 tabular-nums max-sm:hidden">
						{formatTime(item.task.dueAt)}
					</span>
				)}
				<span className="truncate">{item.task.title}</span>
				{owner?.upcoming && (
					<Repeat aria-label="Upcoming repeat" className="size-3 shrink-0 text-neutral-400" />
				)}
				{owner && <span className="sr-only">, {owner.name}</span>}
			</button>
		);
	}
	const owner = owners?.event(item.event);
	if (item.kind === "banner") {
		return (
			<button
				type="button"
				onClick={() => onSelectEvent(item.event)}
				title={owner ? `${owner.name}: ${item.event.title}` : undefined}
				style={owner ? ownerTint(owner.color, true) : undefined}
				className={cn(
					"relative w-full min-w-0 truncate rounded-md px-1.5 py-0.5 text-left text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary/60 max-sm:px-1 max-sm:text-[11px]",
					owner
						? "text-neutral-900 hover:brightness-95"
						: "bg-primary/90 text-primary-foreground hover:bg-primary",
				)}
			>
				{item.event.title}
				{owner && <span className="sr-only">, {owner.name}</span>}
			</button>
		);
	}
	return (
		<button
			type="button"
			onClick={() => onSelectEvent(item.event)}
			title={owner ? `${owner.name}: ${item.event.title}` : undefined}
			className="relative flex w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-xs text-neutral-800 hover:bg-neutral-100 focus-visible:ring-2 focus-visible:ring-primary/40 max-sm:gap-1 max-sm:px-0.5 max-sm:text-[11px]"
		>
			<span
				className="size-1.5 shrink-0 rounded-full bg-primary"
				style={owner ? { backgroundColor: owner.color } : undefined}
			/>
			<span className="shrink-0 text-neutral-500 tabular-nums max-sm:hidden">
				{formatTime(item.event.startsAt)}
			</span>
			<span className="truncate font-medium">{item.event.title}</span>
			{owner && <span className="sr-only">, {owner.name}</span>}
		</button>
	);
}

/** Lists every item of a crowded day in place, without leaving the month. */
function MoreItemsPopover({
	day,
	items,
	hidden,
	handlers,
}: Readonly<{ day: Date; items: DayItem[]; hidden: number; handlers: ItemHandlers }>) {
	const [open, setOpen] = useState(false);
	const close =
		<T,>(select: (value: T) => void) =>
		(value: T) => {
			setOpen(false);
			select(value);
		};
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				aria-label={`+${hidden} more`}
				className="relative w-full rounded-md px-1.5 py-0.5 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-primary/40 max-sm:px-0.5 max-sm:text-[11px]"
			>
				+{hidden}
				<span className="max-sm:hidden"> more</span>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 max-w-[calc(100vw-1rem)] gap-2 p-3">
				<PopoverTitle className="px-1 text-sm text-neutral-900">
					{day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
				</PopoverTitle>
				<div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto overscroll-contain">
					{items.map((item) => (
						<MonthDayItemButton
							key={dayItemKey(item)}
							item={item}
							owners={handlers.owners}
							onSelectEvent={close(handlers.onSelectEvent)}
							onSelectTask={close(handlers.onSelectTask)}
						/>
					))}
				</div>
			</PopoverContent>
		</Popover>
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
	owners,
}: Readonly<CalendarGridProps>) {
	const today = dateKey(new Date());
	const itemsByDay = monthDayItems(events, tasks, { timedTasks: !!owners });
	const handlers: ItemHandlers = { onSelectEvent, onSelectTask, owners };
	const weeks = days.length / 7;

	return (
		<div className="flex h-full min-h-144 flex-col">
			<div className="grid shrink-0 grid-cols-7 border-b border-neutral-200">
				{days.slice(0, 7).map((day) => (
					<div
						key={day.getDay()}
						className="px-2 py-2 text-center text-[11px] font-medium tracking-wide text-neutral-500 uppercase max-sm:px-0 max-sm:text-[10px]"
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
					const items = itemsByDay.get(key) ?? [];
					const { visible, hidden } = splitDayItems(items, DAY_ROWS);
					return (
						<div
							key={key}
							className={cn(
								"group relative flex min-w-0 flex-col gap-0.5 border-r border-b border-neutral-100 px-1 pt-1 pb-1.5 nth-[7n]:border-r-0 max-sm:px-0.5",
								!inMonth && "bg-neutral-50/70",
							)}
						>
							{/* Sits behind the day's content, so empty space creates an event by pointer or keyboard. */}
							{onCreateEvent && (
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
							)}
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
								<MonthDayItemButton key={dayItemKey(item)} item={item} {...handlers} />
							))}
							{hidden.length > 0 &&
								(owners ? (
									<MoreItemsPopover
										day={day}
										items={items}
										hidden={hidden.length}
										handlers={handlers}
									/>
								) : (
									<button
										type="button"
										onClick={() => onOpenDay(day)}
										aria-label={`${hidden.length} more`}
										className="relative w-full rounded-md px-1.5 py-0.5 text-left text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-primary/40 max-sm:px-0.5 max-sm:text-[11px]"
									>
										<span className="sm:hidden">+</span>
										{hidden.length}
										<span className="max-sm:hidden"> more</span>
									</button>
								))}
						</div>
					);
				})}
			</div>
		</div>
	);
}
