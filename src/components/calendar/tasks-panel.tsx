"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Circle, CircleCheck, Flag, ListChecks, Plus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useCurrentAccount } from "@/hooks/use-current-account";
import { calendarKeys, listCalendarTasks } from "@/lib/calendar/client";
import type { CalendarTaskRecord, CalendarTaskScope } from "@/lib/calendar/types";
import { browserTimezone, formatDateTime } from "@/lib/calendar/wall-clock";
import { cn } from "@/lib/utils";
import { PRIORITY_STYLES, errorMessage, formatTaskDue } from "./calendar-utils";
import {
	TASK_SCOPE_OPTIONS,
	TASK_STATUS_OPTIONS,
	getEmptyTaskMessage,
	getTaskDueState,
	getTaskListParams,
	getTaskPermissions,
	getTaskRelationLabel,
	groupTasks,
	isOptimisticTask,
	type TaskDueState,
	type TaskStatusFilter,
} from "./task-utils";
import { useCreateTaskMutation, useTaskCompletionMutation } from "./use-task-mutations";

const SCOPE_STORAGE_KEY = "mailflare:calendar-task-scope";

const DUE_TONES: Record<TaskDueState, string> = {
	overdue: "font-medium text-red-600",
	today: "font-medium text-primary",
	upcoming: "text-neutral-500",
	none: "text-neutral-400",
	completed: "text-neutral-400",
};

function readStoredScope(): CalendarTaskScope {
	try {
		const stored = window.localStorage.getItem(SCOPE_STORAGE_KEY);
		if (stored === "assigned" || stored === "created" || stored === "all") return stored;
	} catch {
		// Storage can be unavailable in private windows; the primary view is a safe default.
	}
	return "assigned";
}

/** Moves focus between task rows with the arrow keys, Home, and End. */
function onTaskListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
	if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
	const rows = Array.from(
		event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-task-row]:not(:disabled)"),
	);
	const index = rows.indexOf(document.activeElement as HTMLButtonElement);
	if (index === -1) return;
	event.preventDefault();
	let next = index;
	if (event.key === "ArrowDown") next = Math.min(index + 1, rows.length - 1);
	if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
	if (event.key === "Home") next = 0;
	if (event.key === "End") next = rows.length - 1;
	rows[next]?.focus();
}

export function TasksPanel({
	onOpenTask,
	onCreateWithDetails,
}: Readonly<{
	onOpenTask: (task: CalendarTaskRecord) => void;
	onCreateWithDetails: (title: string) => void;
}>) {
	const [scope, setScope] = useState<CalendarTaskScope>("assigned");
	const [status, setStatus] = useState<TaskStatusFilter>("open");
	const [title, setTitle] = useState("");
	const account = useCurrentAccount();
	const params = getTaskListParams(scope, status);
	const tasks = useQuery({
		queryKey: calendarKeys.tasks(params),
		queryFn: () => listCalendarTasks(params),
	});
	const create = useCreateTaskMutation();
	const completion = useTaskCompletionMutation();

	useEffect(() => setScope(readStoredScope()), []);

	function changeScope(next: CalendarTaskScope) {
		setScope(next);
		try {
			window.localStorage.setItem(SCOPE_STORAGE_KEY, next);
		} catch {
			// Remembering the view is a convenience only.
		}
	}

	function addTask() {
		const value = title.trim();
		if (!value) return;
		setTitle("");
		create.mutate({ input: { title: value, timezone: browserTimezone() } });
	}

	const now = new Date();
	const groups = groupTasks(tasks.data ?? [], status, now);
	const visibleCount = groups.reduce((total, group) => total + group.tasks.length, 0);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="shrink-0 space-y-2 px-4 pb-2">
				<Tabs value={scope} onValueChange={(value) => changeScope(value as CalendarTaskScope)}>
					<TabsList
						variant="line"
						className="h-8 w-full justify-start gap-4"
						aria-label="Task view"
					>
						{TASK_SCOPE_OPTIONS.map((option) => (
							<TabsTrigger
								key={option.value}
								value={option.value}
								className="flex-none px-0 text-xs"
								aria-label={option.label}
							>
								{option.shortLabel}
							</TabsTrigger>
						))}
					</TabsList>
				</Tabs>

				<form
					onSubmit={(event) => {
						event.preventDefault();
						addTask();
					}}
					className="flex items-center gap-1 rounded-lg bg-neutral-100/80 pr-1 pl-2.5 transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/20"
				>
					<Plus className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
					<input
						value={title}
						maxLength={200}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="Add a task for yourself"
						aria-label="New task title. Press Enter to add it to your tasks."
						enterKeyHint="done"
						className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500"
					/>
					<Tooltip label="Add with assignee, due date, and notes">
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="text-neutral-500"
							aria-label="Add with assignee, due date, and notes"
							onClick={() => {
								onCreateWithDetails(title.trim());
								setTitle("");
							}}
						>
							<SlidersHorizontal />
						</Button>
					</Tooltip>
				</form>

				<div className="flex items-center justify-between">
					<Select
						value={status}
						onValueChange={(value) => value && setStatus(value as TaskStatusFilter)}
					>
						<SelectTrigger
							size="sm"
							aria-label="Task status"
							className="h-7 border-0 px-1.5 text-xs font-medium shadow-none hover:bg-neutral-100"
						>
							<SelectValue>
								{(value: TaskStatusFilter) =>
									TASK_STATUS_OPTIONS.find((option) => option.value === value)?.label
								}
							</SelectValue>
						</SelectTrigger>
						<SelectContent alignItemWithTrigger={false} align="start">
							{TASK_STATUS_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{tasks.isSuccess && visibleCount > 0 && (
						<span className="text-xs text-neutral-400 tabular-nums" aria-live="polite">
							{visibleCount} {visibleCount === 1 ? "task" : "tasks"}
						</span>
					)}
				</div>
			</div>

			<div
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4"
				onKeyDown={onTaskListKeyDown}
			>
				{tasks.isPending && <TaskListSkeleton />}
				{tasks.isError && (
					<div className="flex flex-col items-center gap-2 px-4 py-8 text-center" role="alert">
						<p className="text-sm text-neutral-600">
							{errorMessage(tasks.error, "Couldn’t load tasks.")}
						</p>
						<Button type="button" variant="outline" size="sm" onClick={() => void tasks.refetch()}>
							Try again
						</Button>
					</div>
				)}
				{tasks.isSuccess && groups.length === 0 && (
					<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
						<ListChecks className="size-6 text-neutral-300" aria-hidden="true" />
						<p className="text-sm text-neutral-500">{getEmptyTaskMessage(scope, status)}</p>
					</div>
				)}
				{tasks.isSuccess &&
					groups.map((group) => (
						<section key={group.id} aria-labelledby={`task-group-${group.id}`} className="mb-1">
							<h3
								id={`task-group-${group.id}`}
								className={cn(
									"flex items-center gap-1.5 px-2 pt-3 pb-1 text-[11px] font-medium tracking-wide uppercase",
									group.id === "overdue" ? "text-red-600" : "text-neutral-400",
								)}
							>
								{group.label}
								<span className="font-normal tabular-nums">{group.tasks.length}</span>
							</h3>
							<ul>
								{group.tasks.map((task) => (
									<TaskRow
										key={task.id}
										task={task}
										now={now}
										relation={getTaskRelationLabel(task, account.data?.id, scope)}
										canComplete={getTaskPermissions(task, account.data).canComplete}
										pending={completion.isPending && completion.variables?.task.id === task.id}
										onToggle={() =>
											completion.mutate({ task, completed: task.status !== "completed" })
										}
										onOpen={() => onOpenTask(task)}
									/>
								))}
							</ul>
						</section>
					))}
			</div>
		</div>
	);
}

function TaskListSkeleton() {
	return (
		<div className="space-y-3 px-2 pt-3" aria-label="Loading tasks" role="status">
			{[0, 1, 2].map((row) => (
				<div key={row} className="flex items-start gap-2.5">
					<Skeleton className="mt-0.5 size-4 rounded-full" />
					<div className="flex-1 space-y-1.5">
						<Skeleton className="h-3.5 w-3/4" />
						<Skeleton className="h-3 w-1/3" />
					</div>
				</div>
			))}
		</div>
	);
}

function getDueText(task: CalendarTaskRecord, now: Date): string | null {
	if (task.status === "completed") {
		return task.completedAt ? `Done ${formatDateTime(task.completedAt)}` : "Done";
	}
	return formatTaskDue(task, now);
}

function TaskRow({
	task,
	now,
	relation,
	canComplete,
	pending,
	onToggle,
	onOpen,
}: Readonly<{
	task: CalendarTaskRecord;
	now: Date;
	relation: string | null;
	canComplete: boolean;
	pending: boolean;
	onToggle: () => void;
	onOpen: () => void;
}>) {
	const completed = task.status === "completed";
	const optimistic = isOptimisticTask(task);
	const dueState = getTaskDueState(task, now);
	const dueText = getDueText(task, now);
	const showPriority = !completed && (task.priority === "high" || task.priority === "medium");

	return (
		<li
			className={cn(
				"group flex items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-neutral-50",
				optimistic && "opacity-60",
			)}
		>
			<button
				type="button"
				role="checkbox"
				aria-checked={completed}
				aria-label={completed ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
				onClick={onToggle}
				disabled={optimistic || pending || !canComplete}
				className={cn(
					"mt-0.5 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50",
					completed ? "text-green-600" : "text-neutral-400 hover:text-primary",
				)}
			>
				{completed ? <CircleCheck className="size-[18px]" /> : <Circle className="size-[18px]" />}
			</button>
			<button
				type="button"
				data-task-row
				onClick={onOpen}
				disabled={optimistic}
				className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default"
			>
				<span
					className={cn(
						"line-clamp-2 text-sm wrap-break-word",
						completed ? "text-neutral-400 line-through" : "text-neutral-900",
					)}
				>
					{task.title}
				</span>
				{(dueText || showPriority || relation) && (
					<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
						{dueText && <span className={cn("shrink-0", DUE_TONES[dueState])}>{dueText}</span>}
						{showPriority && (
							<span className={cn("flex shrink-0 items-center", PRIORITY_STYLES[task.priority])}>
								<Flag className="size-3" aria-hidden="true" />
								<span className="sr-only">{task.priority} priority</span>
							</span>
						)}
						{relation && (
							<span className="min-w-0 truncate" title={relation}>
								{dueText || showPriority ? `· ${relation}` : relation}
							</span>
						)}
					</span>
				)}
				{optimistic && <span className="sr-only">Saving</span>}
			</button>
		</li>
	);
}
