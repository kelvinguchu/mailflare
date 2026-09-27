"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	CalendarDays,
	CalendarPlus,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ListTodo,
	PanelRight,
} from "lucide-react";
import { CalendarSidePanel } from "@/components/calendar/calendar-side-panel";
import type {
	CalendarGridProps,
	CalendarView,
	EventDialogState,
	ReminderDialogState,
	TaskDialogState,
} from "@/components/calendar/calendar-types";
import { errorMessage, nextHalfHour } from "@/components/calendar/calendar-utils";
import { EventDialog } from "@/components/calendar/event-dialog";
import { MonthView } from "@/components/calendar/month-view";
import { ReminderDialog } from "@/components/calendar/reminder-dialog";
import { TaskDialog } from "@/components/calendar/task-dialog";
import { OPEN_TASK_EVENT } from "@/components/calendar/task-utils";
import { TimeGridView } from "@/components/calendar/time-grid-view";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/toast";
import {
	calendarKeys,
	getCalendarEvent,
	getCalendarTask,
	listCalendarEvents,
	listCalendarTasks,
} from "@/lib/calendar/client";
import type { CalendarReminderRecord } from "@/lib/calendar/types";
import { startOfLocalDay } from "@/lib/calendar/wall-clock";
import { cn } from "@/lib/utils";
import { queryRange, rangeTitle, shiftAnchor, visibleDays } from "./utils";

const VIEWS: Array<{ value: CalendarView; label: string; shortcut: string }> = [
	{ value: "month", label: "Month", shortcut: "m" },
	{ value: "week", label: "Week", shortcut: "w" },
	{ value: "day", label: "Day", shortcut: "d" },
];

export default function CalendarPage() {
	const [view, setView] = useState<CalendarView>("month");
	const [anchor, setAnchor] = useState(() => startOfLocalDay(new Date()));
	const [eventDialog, setEventDialog] = useState<EventDialogState | null>(null);
	const [taskDialog, setTaskDialog] = useState<TaskDialogState | null>(null);
	const [reminderDialog, setReminderDialog] = useState<ReminderDialogState | null>(null);
	const [panelOpen, setPanelOpen] = useState(false);

	const days = useMemo(() => visibleDays(view, anchor), [view, anchor]);
	const range = useMemo(() => queryRange(days), [days]);
	const taskParams = {
		status: "all" as const,
		scope: "all" as const,
		start: range.start,
		end: range.end,
	};
	const events = useQuery({
		queryKey: calendarKeys.events(range.start, range.end),
		queryFn: () => listCalendarEvents(range.start, range.end),
		placeholderData: keepPreviousData,
		refetchOnMount: "always",
	});
	const tasks = useQuery({
		queryKey: calendarKeys.tasks(taskParams),
		queryFn: () => listCalendarTasks(taskParams),
		placeholderData: keepPreviousData,
		refetchOnMount: "always",
	});
	const anyDialogOpen = Boolean(eventDialog || taskDialog || reminderDialog || panelOpen);

	useEffect(() => {
		function onKeyDown(event: KeyboardEvent) {
			if (anyDialogOpen || event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (target?.closest("input, textarea, select, [contenteditable=true], [role=combobox]"))
				return;
			const key = event.key.toLowerCase();
			const nextView = VIEWS.find((item) => item.shortcut === key)?.value;
			if (nextView) setView(nextView);
			else if (key === "t") setAnchor(startOfLocalDay(new Date()));
			else if (key === "arrowleft" || key === "k")
				setAnchor((current) => shiftAnchor(view, current, -1));
			else if (key === "arrowright" || key === "j")
				setAnchor((current) => shiftAnchor(view, current, 1));
			else if (key === "c") openNewEvent();
			else return;
			event.preventDefault();
		}
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	});

	// Tasks open from notification links (`?task=`) and from in-app notification actions.
	useEffect(() => {
		async function openTask(taskId: string) {
			setPanelOpen(false);
			try {
				setTaskDialog({ mode: "view", task: await getCalendarTask(taskId) });
			} catch {
				toast.add({
					title: "Couldn’t open task",
					description: "It was deleted, or you no longer have access to it.",
					type: "error",
				});
			}
		}
		const url = new URL(window.location.href);
		const linkedTaskId = url.searchParams.get("task");
		if (linkedTaskId) {
			url.searchParams.delete("task");
			window.history.replaceState(window.history.state, "", url);
			void openTask(linkedTaskId);
		}
		const onOpenTask = (event: Event) => {
			const taskId = (event as CustomEvent<string>).detail;
			if (!taskId) return;
			// Tells the notification this page handled it, so it doesn't navigate.
			event.preventDefault();
			void openTask(taskId);
		};
		window.addEventListener(OPEN_TASK_EVENT, onOpenTask);
		return () => window.removeEventListener(OPEN_TASK_EVENT, onOpenTask);
	}, []);

	function openNewEvent(start = nextHalfHour()) {
		setEventDialog({
			mode: "create",
			draft: { start, end: new Date(start.getTime() + 3_600_000), allDay: false },
		});
	}

	function editReminderFromPanel(reminder: CalendarReminderRecord) {
		// Close the mobile sheet first: sibling modal dialogs would dismiss each other.
		setPanelOpen(false);
		setReminderDialog({
			reminder,
			target: {
				kind: reminder.eventId ? "event" : "task",
				id: reminder.eventId ?? reminder.taskId ?? "",
				title: reminder.title,
				timezone: reminder.timezone,
				anchor: null,
			},
		});
	}

	async function openReminderTarget(reminder: CalendarReminderRecord) {
		try {
			if (reminder.eventId) {
				setEventDialog({ mode: "view", event: await getCalendarEvent(reminder.eventId) });
			} else if (reminder.taskId) {
				setTaskDialog({ mode: "view", task: await getCalendarTask(reminder.taskId) });
			}
			setPanelOpen(false);
		} catch (error) {
			toast.add({ title: "Couldn’t open item", description: errorMessage(error), type: "error" });
		}
	}

	const panel = (
		<CalendarSidePanel
			onOpenTask={(task) => {
				setPanelOpen(false);
				setTaskDialog({ mode: "view", task });
			}}
			onCreateTask={(title) => {
				setPanelOpen(false);
				setTaskDialog({ mode: "create", title });
			}}
			onOpenReminderTarget={(reminder) => void openReminderTarget(reminder)}
			onEditReminder={editReminderFromPanel}
		/>
	);

	const gridProps: CalendarGridProps = {
		days,
		anchor,
		events: events.data ?? [],
		tasks: tasks.data ?? [],
		onSelectEvent: (event) => setEventDialog({ mode: "view", event }),
		onSelectTask: (task) => setTaskDialog({ mode: "view", task }),
		onCreateEvent: (draft) => setEventDialog({ mode: "create", draft }),
		onOpenDay: (day) => {
			setAnchor(startOfLocalDay(day));
			setView("day");
		},
	};
	const loadError = events.error ?? tasks.error;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-neutral-100 px-3 py-3 sm:gap-x-3 sm:px-6">
				<h1 className="flex items-center gap-2 text-xl font-medium text-neutral-900">
					<CalendarDays aria-hidden="true" className="size-6 text-primary" />
					<span className="sr-only sm:not-sr-only">Calendar</span>
				</h1>
				<div className="flex items-center gap-1">
					<Button
						variant="outline"
						size="sm"
						className="rounded-full px-4"
						onClick={() => setAnchor(startOfLocalDay(new Date()))}
						title="Today (T)"
					>
						Today
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="rounded-full"
						aria-label={`Previous ${view}`}
						onClick={() => setAnchor((current) => shiftAnchor(view, current, -1))}
					>
						<ChevronLeft />
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						className="rounded-full"
						aria-label={`Next ${view}`}
						onClick={() => setAnchor((current) => shiftAnchor(view, current, 1))}
					>
						<ChevronRight />
					</Button>
				</div>
				<h2 className="text-lg text-neutral-800" aria-live="polite">
					{rangeTitle(view, days, anchor)}
				</h2>
				{(events.isFetching || tasks.isFetching) && (
					<span role="status" className="inline-flex items-center gap-2 text-sm text-neutral-500">
						<Spinner aria-hidden="true" className="text-neutral-400" />
						<span className="sr-only">Updating calendar…</span>
					</span>
				)}
				<span className="flex-1" />
				<div
					className="flex rounded-full bg-neutral-100 p-0.5"
					role="radiogroup"
					aria-label="Calendar view"
				>
					{VIEWS.map((item) => (
						<button
							key={item.value}
							type="button"
							role="radio"
							aria-checked={view === item.value}
							title={`${item.label} (${item.shortcut.toUpperCase()})`}
							onClick={() => setView(item.value)}
							className={cn(
								"rounded-full px-3 py-1 text-sm font-medium transition-colors",
								view === item.value
									? "bg-white text-neutral-900 shadow-sm"
									: "text-neutral-500 hover:text-neutral-800",
							)}
						>
							{item.label}
						</button>
					))}
				</div>
				<DropdownMenu>
					<DropdownMenuTrigger render={<Button className="rounded-full pr-3 pl-4" />}>
						Create
						<ChevronDown />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-44">
						<DropdownMenuItem onClick={() => openNewEvent()}>
							<CalendarPlus />
							Event
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => setTaskDialog({ mode: "create" })}>
							<ListTodo />
							Task
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<Button
					variant="outline"
					size="icon-sm"
					className="rounded-full lg:hidden"
					aria-label="Tasks and reminders"
					onClick={() => setPanelOpen(true)}
				>
					<PanelRight />
				</Button>
			</header>

			<div className="flex min-h-0 flex-1">
				<section
					className="flex min-w-0 flex-1 flex-col overflow-auto overscroll-contain"
					aria-label="Calendar grid"
					aria-busy={events.isFetching || tasks.isFetching}
				>
					{loadError && (
						<p
							role="alert"
							className="mx-4 mt-3 rounded-lg border border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700"
						>
							{errorMessage(loadError, "Couldn’t load your calendar.")}
						</p>
					)}
					<div
						className={cn(
							"h-full min-h-0 flex-1",
							view === "month" && "min-w-[44rem]",
							view === "week" && "min-w-[56rem]",
							view === "day" && "min-w-[28rem]",
						)}
					>
						{view === "month" ? <MonthView {...gridProps} /> : <TimeGridView {...gridProps} />}
					</div>
				</section>
				<aside className="hidden w-80 shrink-0 flex-col border-l border-neutral-100 lg:flex">
					{panel}
				</aside>
			</div>

			<Sheet open={panelOpen} onOpenChange={setPanelOpen}>
				<SheetContent className="w-[min(22rem,100vw)] gap-0 p-0 pt-10">
					<SheetTitle className="sr-only">Tasks and reminders</SheetTitle>
					{panelOpen && panel}
				</SheetContent>
			</Sheet>

			<EventDialog state={eventDialog} onStateChange={setEventDialog} />
			<TaskDialog state={taskDialog} onStateChange={setTaskDialog} />
			<ReminderDialog state={reminderDialog} onClose={() => setReminderDialog(null)} />
		</div>
	);
}
