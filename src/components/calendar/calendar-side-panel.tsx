"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { calendarKeys, listCalendarReminders } from "@/lib/calendar/client";
import type {
	CalendarReminderListParams,
	CalendarReminderRecord,
	CalendarTaskRecord,
} from "@/lib/calendar/types";
import { DUE_REMINDER_PARAMS, REMINDER_STATUS_FILTERS, errorMessage } from "./calendar-utils";
import { ReminderRow } from "./reminder-row";
import { TasksPanel } from "./tasks-panel";

type ReminderFilter = (typeof REMINDER_STATUS_FILTERS)[number]["value"];

export function CalendarSidePanel({
	onOpenTask,
	onCreateTask,
	onOpenReminderTarget,
	onEditReminder,
}: {
	onOpenTask: (task: CalendarTaskRecord) => void;
	onCreateTask: (title: string) => void;
	onOpenReminderTarget: (reminder: CalendarReminderRecord) => void;
	onEditReminder: (reminder: CalendarReminderRecord) => void;
}) {
	const due = useQuery({
		queryKey: calendarKeys.reminders(DUE_REMINDER_PARAMS),
		queryFn: () => listCalendarReminders(DUE_REMINDER_PARAMS),
	});
	const dueCount = due.data?.length ?? 0;
	const [tab, setTab] = useState<"tasks" | "reminders">("tasks");

	return (
		<Tabs
			value={tab}
			onValueChange={(value) => setTab(value as "tasks" | "reminders")}
			className="flex h-full min-h-0 flex-col gap-0"
		>
			<div className="shrink-0 px-4 pt-4 pb-2">
				<TabsList className="w-full">
					<TabsTrigger value="tasks">Tasks</TabsTrigger>
					<TabsTrigger value="reminders">
						Reminders
						{dueCount > 0 && (
							<span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white">
								{dueCount}
							</span>
						)}
					</TabsTrigger>
				</TabsList>
			</div>
			<TabsContent value="tasks" className="flex min-h-0 flex-col">
				<TasksPanel onOpenTask={onOpenTask} onCreateWithDetails={onCreateTask} />
			</TabsContent>
			<TabsContent value="reminders" className="flex min-h-0 flex-col">
				<RemindersPanel
					initialFilter={dueCount > 0 ? "due" : "scheduled"}
					onOpenTarget={onOpenReminderTarget}
					onEdit={onEditReminder}
				/>
			</TabsContent>
		</Tabs>
	);
}

function FilterSelect<Value extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: Value;
	options: Array<{ value: Value; label: string }>;
	onChange: (value: Value) => void;
}) {
	return (
		<Select value={value} onValueChange={(next) => next && onChange(next as Value)}>
			<SelectTrigger
				size="sm"
				aria-label={label}
				className="h-8 border-0 px-2 font-medium shadow-none hover:bg-neutral-100"
			>
				<SelectValue>
					{(current: Value) => options.find((option) => option.value === current)?.label}
				</SelectValue>
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={false} align="start">
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function PanelMessage({ children }: { children: React.ReactNode }) {
	return <p className="px-4 py-8 text-center text-sm text-neutral-500">{children}</p>;
}

function RemindersPanel({
	initialFilter,
	onOpenTarget,
	onEdit,
}: {
	initialFilter: ReminderFilter;
	onOpenTarget: (reminder: CalendarReminderRecord) => void;
	onEdit: (reminder: CalendarReminderRecord) => void;
}) {
	const [filter, setFilter] = useState<ReminderFilter>(initialFilter);
	const params: CalendarReminderListParams =
		filter === "due" ? DUE_REMINDER_PARAMS : { status: filter };
	const reminders = useQuery({
		queryKey: calendarKeys.reminders(params),
		queryFn: () => listCalendarReminders(params),
		refetchOnMount: "always",
	});
	const items =
		filter === "all" || filter === "dismissed" || filter === "cancelled"
			? [...(reminders.data ?? [])].reverse()
			: (reminders.data ?? []);

	return (
		<>
			<div className="shrink-0 px-4 pb-2">
				<FilterSelect
					label="Reminder filter"
					value={filter}
					options={REMINDER_STATUS_FILTERS}
					onChange={setFilter}
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
				{reminders.isPending ? (
					<PanelMessage>Loading reminders…</PanelMessage>
				) : reminders.isError ? (
					<PanelMessage>{errorMessage(reminders.error)}</PanelMessage>
				) : items.length === 0 ? (
					<div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
						<BellRing className="size-6 text-neutral-300" />
						<p className="text-sm text-neutral-500">
							{filter === "due"
								? "You’re all caught up."
								: filter === "scheduled"
									? "No upcoming reminders. Open an event or task to add one."
									: "Nothing here."}
						</p>
					</div>
				) : (
					items.map((reminder) => (
						<ReminderRow
							key={reminder.id}
							reminder={reminder}
							onEdit={onEdit}
							onOpenTarget={onOpenTarget}
						/>
					))
				)}
			</div>
		</>
	);
}
