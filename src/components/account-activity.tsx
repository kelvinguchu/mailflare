"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import {
	ArrowRight,
	BellRing,
	Circle,
	CircleCheck,
	ListTodo,
	Plus,
	RefreshCw,
	UserRoundCheck,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DUE_REMINDER_PARAMS, formatTaskDue } from "@/components/calendar/calendar-utils";
import { useReminderActions } from "@/components/calendar/reminder-row";
import { getTaskDueState } from "@/components/calendar/task-utils";
import { useTaskCompletionMutation } from "@/components/calendar/use-task-mutations";
import { CALENDAR_REALTIME_EVENT, openTaskFromNotification } from "@/hooks/message-realtime-utils";
import { calendarKeys, listCalendarReminders, listCalendarTasks } from "@/lib/calendar/client";
import type { CalendarReminderRecord, CalendarTaskRecord } from "@/lib/calendar/types";
import { formatTime } from "@/lib/calendar/wall-clock";
import type { TaskChangeNotification } from "@/lib/realtime/types";
import {
	addActivityItem,
	formatRelativeTime,
	getAttentionCount,
	inAppReminders,
	summarizeTasks,
	type ActivityItem,
	type TaskSummary,
} from "./account-activity-utils";

const ASSIGNED_OPEN = { scope: "assigned", status: "open" } as const;
const TASK_POLL_MS = 5 * 60_000;
const REMINDER_POLL_MS = 60_000;

type ActivityTab = "tasks" | "notifications";

export type AccountActivity = {
	summary: TaskSummary;
	tasksLoading: boolean;
	tasksError: boolean;
	reminders: CalendarReminderRecord[];
	items: ActivityItem[];
	unseenIds: string[];
	attention: number;
	markSeen: () => void;
};

/** Always-on so the avatar can show a badge; the queries share keys with the calendar page. */
export function useAccountActivity(): AccountActivity {
	const queryClient = useQueryClient();
	const [items, setItems] = useState<ActivityItem[]>([]);
	const [unseenIds, setUnseenIds] = useState<string[]>([]);
	const tasks = useQuery({
		queryKey: calendarKeys.tasks(ASSIGNED_OPEN),
		queryFn: () => listCalendarTasks(ASSIGNED_OPEN),
		refetchInterval: TASK_POLL_MS,
		refetchIntervalInBackground: false,
		retry: false,
	});
	const due = useQuery({
		queryKey: calendarKeys.reminders(DUE_REMINDER_PARAMS),
		queryFn: () => listCalendarReminders(DUE_REMINDER_PARAMS),
		refetchInterval: REMINDER_POLL_MS,
		refetchIntervalInBackground: false,
		retry: false,
	});

	useEffect(() => {
		function onTaskChange(event: Event) {
			const detail = (event as CustomEvent<TaskChangeNotification>).detail;
			if (detail?.type !== "task_changed") return;
			setItems((current) => addActivityItem(current, detail));
			setUnseenIds((current) =>
				current.includes(detail.eventId) ? current : [...current, detail.eventId],
			);
			void queryClient.invalidateQueries({ queryKey: calendarKeys.tasks(ASSIGNED_OPEN) });
		}
		window.addEventListener(CALENDAR_REALTIME_EVENT, onTaskChange);
		return () => window.removeEventListener(CALENDAR_REALTIME_EVENT, onTaskChange);
	}, [queryClient]);

	const markSeen = useCallback(() => setUnseenIds([]), []);
	const summary = summarizeTasks(tasks.data ?? []);
	const reminders = inAppReminders(due.data);
	return {
		summary,
		tasksLoading: tasks.isPending && tasks.fetchStatus !== "idle",
		tasksError: tasks.isError,
		reminders,
		items,
		unseenIds,
		attention: getAttentionCount(summary, reminders.length, unseenIds.length),
		markSeen,
	};
}

/** A quiet dot: something needs attention, without a count competing with the inbox badge. */
export function AttentionDot({ show }: Readonly<{ show: boolean }>) {
	if (!show) return null;
	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute top-1.5 right-1.5 size-2.5 rounded-full bg-red-600 ring-2 ring-[#f6f8fc]"
		/>
	);
}

export function AccountActivityPanel({
	activity,
	onNavigate,
	onNewTask,
	onOpenTask,
}: Readonly<{
	activity: AccountActivity;
	onNavigate: () => void;
	onNewTask: () => void;
	/** Opens a listed task in place; other notifications only carry an id and go to the calendar. */
	onOpenTask: (task: CalendarTaskRecord) => void;
}>) {
	const notificationCount = activity.reminders.length + activity.unseenIds.length;
	const [tab, setTab] = useState<ActivityTab>(() =>
		notificationCount > 0 ? "notifications" : "tasks",
	);
	// Rows keep their unread dot for this viewing even after the badge clears.
	const [unreadAtOpen] = useState(() => new Set(activity.unseenIds));
	const { markSeen, unseenIds } = activity;

	useEffect(() => {
		if (tab === "notifications" && unseenIds.length > 0) markSeen();
	}, [tab, unseenIds.length, markSeen]);

	const openTask = (taskId: string) => {
		onNavigate();
		openTaskFromNotification(taskId);
	};

	return (
		<section aria-label="Tasks and notifications" className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex items-center gap-2 px-3 pt-3">
				<div role="tablist" aria-label="Activity" className="flex flex-1 gap-1">
					<TabButton
						active={tab === "tasks"}
						count={activity.summary.total}
						urgent={activity.summary.overdue > 0}
						onClick={() => setTab("tasks")}
					>
						Tasks
					</TabButton>
					<TabButton
						active={tab === "notifications"}
						count={notificationCount}
						urgent={notificationCount > 0}
						onClick={() => setTab("notifications")}
					>
						Notifications
					</TabButton>
				</div>
				<Button type="button" size="sm" className="shrink-0 rounded-full" onClick={onNewTask}>
					<Plus />
					New task
				</Button>
			</div>
			<div
				role="tabpanel"
				aria-label={tab === "tasks" ? "Tasks" : "Notifications"}
				className="min-h-0 flex-1 overflow-y-auto p-2"
			>
				{tab === "tasks" ? (
					<TasksTab activity={activity} onOpen={onOpenTask} onNavigate={onNavigate} />
				) : (
					<NotificationsTab
						activity={activity}
						unread={unreadAtOpen}
						onOpen={openTask}
						onNavigate={onNavigate}
					/>
				)}
			</div>
		</section>
	);
}

function TabButton({
	active,
	count,
	urgent,
	onClick,
	children,
}: Readonly<{
	active: boolean;
	count: number;
	urgent: boolean;
	onClick: () => void;
	children: React.ReactNode;
}>) {
	return (
		<button
			type="button"
			role="tab"
			aria-selected={active}
			onClick={onClick}
			className={cn(
				"flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
				active ? "bg-primary/10 text-primary" : "text-neutral-600 hover:bg-neutral-100",
			)}
		>
			{children}
			{count > 0 && (
				<span
					className={cn(
						"min-w-5 rounded-full px-1.5 text-[11px] font-semibold leading-5",
						urgent ? "bg-red-600 text-white" : "bg-neutral-200 text-neutral-700",
					)}
				>
					{count > 99 ? "99+" : count}
				</span>
			)}
		</button>
	);
}

function TasksTab({
	activity,
	onOpen,
	onNavigate,
}: Readonly<{
	activity: AccountActivity;
	onOpen: (task: CalendarTaskRecord) => void;
	onNavigate: () => void;
}>) {
	const completion = useTaskCompletionMutation();
	const { summary } = activity;
	const now = new Date();

	if (activity.tasksLoading) {
		return (
			<div className="space-y-2 p-2" aria-busy="true">
				<Skeleton className="h-9 w-full rounded-lg" />
				<Skeleton className="h-9 w-full rounded-lg" />
			</div>
		);
	}
	if (activity.tasksError) {
		return <p className="px-3 py-4 text-sm text-neutral-500">Tasks couldn’t load right now.</p>;
	}
	if (summary.total === 0) {
		return (
			<EmptyState
				icon={<CircleCheck className="size-5" />}
				text="No open tasks. You’re all caught up."
			/>
		);
	}

	const headline = [
		summary.overdue > 0 ? `${summary.overdue} overdue` : null,
		summary.today > 0 ? `${summary.today} due today` : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<>
			<p className="px-3 pb-1 pt-0.5 text-xs text-neutral-500">
				{headline || `${summary.total} open ${summary.total === 1 ? "task" : "tasks"}`}
			</p>
			<ul className="space-y-0.5">
				{summary.visible.map((task) => (
					<MenuTaskRow
						key={task.id}
						task={task}
						now={now}
						pending={completion.isPending && completion.variables?.task.id === task.id}
						onToggle={() => completion.mutate({ task, completed: task.status !== "completed" })}
						onOpen={() => onOpen(task)}
					/>
				))}
			</ul>
			<FooterLink
				href="/calendar"
				onNavigate={onNavigate}
				label={
					summary.total > summary.visible.length
						? `View all ${summary.total} tasks`
						: "Open tasks in Calendar"
				}
			/>
		</>
	);
}

function MenuTaskRow({
	task,
	now,
	pending,
	onToggle,
	onOpen,
}: Readonly<{
	task: CalendarTaskRecord;
	now: Date;
	pending: boolean;
	onToggle: () => void;
	onOpen: () => void;
}>) {
	const completed = task.status === "completed";
	const state = getTaskDueState(task, now);
	const due = formatTaskDue(task, now);

	return (
		<li className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-[#f2f6fc]">
			<button
				type="button"
				role="checkbox"
				aria-checked={completed}
				aria-label={completed ? `Reopen “${task.title}”` : `Complete “${task.title}”`}
				disabled={pending}
				onClick={onToggle}
				className={cn(
					"shrink-0 rounded-full p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
					completed ? "text-green-600" : "text-neutral-400 hover:text-primary",
				)}
			>
				{completed ? <CircleCheck className="size-[18px]" /> : <Circle className="size-[18px]" />}
			</button>
			<button
				type="button"
				onClick={onOpen}
				className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
			>
				<span
					className={cn(
						"flex items-center gap-1.5 truncate text-sm",
						completed ? "text-neutral-400 line-through" : "font-medium text-neutral-900",
					)}
				>
					{task.priority === "high" && !completed && (
						<span className="size-1.5 shrink-0 rounded-full bg-red-500">
							<span className="sr-only">High priority</span>
						</span>
					)}
					<span className="truncate">{task.title}</span>
				</span>
				{due && (
					<span
						className={cn(
							"block truncate text-xs",
							state === "overdue" && "font-medium text-red-600",
							state === "today" && "font-medium text-primary",
							(state === "upcoming" || state === "completed") && "text-neutral-500",
						)}
					>
						{state === "overdue" ? `Overdue · ${due}` : due}
					</span>
				)}
			</button>
		</li>
	);
}

function NotificationsTab({
	activity,
	unread,
	onOpen,
	onNavigate,
}: Readonly<{
	activity: AccountActivity;
	unread: Set<string>;
	onOpen: (taskId: string) => void;
	onNavigate: () => void;
}>) {
	const { reminders, items } = activity;
	if (reminders.length === 0 && items.length === 0) {
		return (
			<EmptyState
				icon={<BellRing className="size-5" />}
				text="No notifications. Reminders and task updates show up here."
			/>
		);
	}
	return (
		<div className="space-y-2">
			{reminders.length > 0 && (
				<div>
					<p className="px-3 pb-1 pt-0.5 text-xs font-medium text-amber-700">Reminders</p>
					<ul className="space-y-0.5">
						{reminders.map((reminder) => (
							<MenuReminderRow
								key={reminder.id}
								reminder={reminder}
								onOpen={() => {
									if (reminder.taskId) onOpen(reminder.taskId);
								}}
							/>
						))}
					</ul>
				</div>
			)}
			{items.length > 0 && (
				<div>
					<p className="px-3 pb-1 pt-0.5 text-xs font-medium text-neutral-500">Task updates</p>
					<ul className="space-y-0.5">
						{items.map((item) => (
							<ActivityRow
								key={item.id}
								item={item}
								unread={unread.has(item.id)}
								onOpen={() => {
									if (item.taskId && item.opens) onOpen(item.taskId);
								}}
							/>
						))}
					</ul>
				</div>
			)}
			<FooterLink href="/calendar" onNavigate={onNavigate} label="Open Calendar" />
		</div>
	);
}

function MenuReminderRow({
	reminder,
	onOpen,
}: Readonly<{ reminder: CalendarReminderRecord; onOpen: () => void }>) {
	const { dismiss, pending } = useReminderActions(reminder);
	const body = (
		<>
			<span className="block truncate text-sm font-medium text-neutral-900">{reminder.title}</span>
			<span className="block truncate text-xs text-neutral-500">
				{formatTime(reminder.remindAt)}
				{reminder.message ? ` · ${reminder.message}` : ""}
			</span>
		</>
	);
	return (
		<li className="flex items-center gap-2.5 rounded-xl bg-amber-50/70 px-2 py-1.5">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
				<BellRing className="size-4" />
			</span>
			{reminder.taskId ? (
				<button
					type="button"
					onClick={onOpen}
					className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
				>
					{body}
				</button>
			) : (
				<div className="min-w-0 flex-1">{body}</div>
			)}
			<button
				type="button"
				disabled={pending}
				onClick={() => dismiss.mutate()}
				aria-label={`Dismiss reminder “${reminder.title}”`}
				className="shrink-0 rounded-full p-1 text-neutral-400 outline-none hover:bg-amber-100 hover:text-neutral-700 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
			>
				<X className="size-4" />
			</button>
		</li>
	);
}

const ACTIVITY_ICONS: Partial<Record<ActivityItem["action"], typeof ListTodo>> = {
	completed: CircleCheck,
	assigned: UserRoundCheck,
	reassigned: RefreshCw,
	reopened: RefreshCw,
	updated: RefreshCw,
};

function ActivityRow({
	item,
	unread,
	onOpen,
}: Readonly<{ item: ActivityItem; unread: boolean; onOpen: () => void }>) {
	const Icon = ACTIVITY_ICONS[item.action] ?? ListTodo;
	return (
		<li>
			<button
				type="button"
				onClick={onOpen}
				disabled={!item.opens}
				className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left outline-none hover:bg-[#f2f6fc] focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-default disabled:hover:bg-transparent"
			>
				<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
					<Icon className="size-4" />
				</span>
				<span className="min-w-0 flex-1">
					<span
						className={cn(
							"block truncate text-sm",
							unread ? "font-semibold text-neutral-900" : "text-neutral-800",
						)}
					>
						{item.title}
					</span>
					<span className="block truncate text-xs text-neutral-500">
						{item.description} · {formatRelativeTime(item.occurredAt)}
					</span>
				</span>
				{unread && (
					<span className="size-2 shrink-0 rounded-full bg-primary">
						<span className="sr-only">New</span>
					</span>
				)}
			</button>
		</li>
	);
}

function EmptyState({ icon, text }: Readonly<{ icon: React.ReactNode; text: string }>) {
	return (
		<div className="flex items-center gap-3 px-3 py-4 text-sm text-neutral-500">
			<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
				{icon}
			</span>
			{text}
		</div>
	);
}

function FooterLink({
	href,
	label,
	onNavigate,
}: Readonly<{ href: string; label: string; onNavigate: () => void }>) {
	return (
		<Link
			href={href}
			onClick={onNavigate}
			className="mt-1 flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium text-primary hover:bg-[#f2f6fc]"
		>
			{label}
			<ArrowRight className="size-4" />
		</Link>
	);
}
