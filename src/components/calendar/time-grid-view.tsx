"use client";

import { useEffect, useRef, useState } from "react";
import { Circle, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import {
	MINUTES_PER_DAY,
	dateKey,
	eventDayKeys,
	formatTime,
	isMultiDayTimed,
	layoutTimedEvents,
} from "@/lib/calendar/wall-clock";
import type { CalendarGridProps } from "./calendar-types";
import { defaultEventStart, getTaskTone, taskDueKey, type TaskTone } from "./calendar-utils";

const HOUR_HEIGHT = 48;
const SLOT_MINUTES = 30;

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
}: Readonly<CalendarGridProps>) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const now = useNow();
	const today = dateKey(now);
	const keys = days.map(dateKey);
	const bannerEvents = events.filter((event) => event.allDay || isMultiDayTimed(event));
	const timedEvents = events.filter((event) => !event.allDay && !isMultiDayTimed(event));
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
						className="flex flex-col items-center gap-0.5 py-2 hover:bg-neutral-50"
					>
						<span
							className={cn(
								"text-[11px] font-medium tracking-wide uppercase",
								keys[index] === today ? "text-primary" : "text-neutral-500",
							)}
						>
							{day.toLocaleDateString(undefined, { weekday: "short" })}
						</span>
						<span
							className={cn(
								"flex size-9 items-center justify-center rounded-full text-lg",
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
					const dayTasks = tasks.filter((task) => taskDueKey(task) === key);
					return (
						<div
							key={key}
							className="flex min-h-8 min-w-0 flex-col gap-0.5 border-l border-neutral-100 p-1"
						>
							{banners.map((event) => (
								<button
									key={event.id}
									type="button"
									onClick={() => onSelectEvent(event)}
									className="w-full truncate rounded-md bg-primary/90 px-1.5 py-0.5 text-left text-xs font-medium text-primary-foreground hover:bg-primary"
								>
									{event.title}
								</button>
							))}
							{dayTasks.map((task) => (
								<button
									key={task.id}
									type="button"
									onClick={() => onSelectTask(task)}
									className={cn(
										"flex w-full min-w-0 items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-left text-xs hover:bg-neutral-50",
										TASK_CHIP_TONES[getTaskTone(task, now)],
									)}
								>
									{task.status === "completed" ? (
										<CircleCheck className="size-3 shrink-0" />
									) : (
										<Circle className="size-3 shrink-0" />
									)}
									{!task.allDay && task.dueAt && (
										<span className="shrink-0 tabular-nums text-neutral-500">
											{formatTime(task.dueAt)}
										</span>
									)}
									<span className="truncate">{task.title}</span>
								</button>
							))}
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
						const layout = layoutTimedEvents(timedEvents, day);
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
								{layout.map(({ item, startMinute, endMinute, column, columns: count }) => {
									const height = ((endMinute - startMinute) / 60) * HOUR_HEIGHT;
									return (
										<button
											key={item.id}
											type="button"
											onClick={() => onSelectEvent(item)}
											className="absolute overflow-hidden rounded-md border border-white bg-primary/12 px-1.5 py-0.5 text-left text-xs text-primary shadow-[inset_3px_0_0_var(--color-primary)] hover:bg-primary/20"
											style={{
												top: (startMinute / 60) * HOUR_HEIGHT,
												height,
												left: `calc(${(column / count) * 100}% + 2px)`,
												width: `calc(${100 / count}% - 4px)`,
											}}
										>
											<span className="block truncate font-semibold">{item.title}</span>
											{height >= 34 && (
												<span className="block truncate text-primary/80 tabular-nums">
													{formatTime(item.startsAt)} – {formatTime(item.endsAt)}
												</span>
											)}
											{height >= 56 && item.location && (
												<span className="block truncate text-primary/70">{item.location}</span>
											)}
										</button>
									);
								})}
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

function useNow(intervalMs = 60_000): Date {
	const [now, setNow] = useState(() => new Date());
	useEffect(() => {
		const timer = window.setInterval(() => setNow(new Date()), intervalMs);
		return () => window.clearInterval(timer);
	}, [intervalMs]);
	return now;
}
