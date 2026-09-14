"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { calendarKeys, listCalendarReminders } from "@/lib/calendar/client";
import type { CalendarReminderRecord } from "@/lib/calendar/types";
import { formatTime } from "@/lib/calendar/wall-clock";
import { CALENDAR_REALTIME_EVENT } from "@/hooks/message-realtime-utils";
import { DUE_REMINDER_PARAMS } from "./calendar-utils";
import { SnoozeMenu, useReminderActions } from "./reminder-row";
import { invalidateTaskQueries } from "./use-task-mutations";

const MAX_VISIBLE = 3;
/** The scheduler runs every minute, so polling faster would not surface reminders sooner. */
const POLL_INTERVAL_MS = 60_000;

/** Pops up in-app calendar reminders once the scheduler has delivered them. */
export function ReminderNotifier() {
	const queryClient = useQueryClient();
	const due = useQuery({
		queryKey: calendarKeys.reminders(DUE_REMINDER_PARAMS),
		queryFn: () => listCalendarReminders(DUE_REMINDER_PARAMS),
		refetchInterval: POLL_INTERVAL_MS,
		refetchIntervalInBackground: false,
		refetchOnWindowFocus: true,
		retry: false,
	});
	useEffect(() => {
		// Task changes can reassign, complete, or delete tasks and cancel their reminders.
		const refresh = () => void invalidateTaskQueries(queryClient);
		window.addEventListener(CALENDAR_REALTIME_EVENT, refresh);
		return () => window.removeEventListener(CALENDAR_REALTIME_EVENT, refresh);
	}, [queryClient]);
	const reminders = (due.data ?? []).filter((reminder) => reminder.channel === "in_app");
	if (reminders.length === 0) return null;
	const visible = reminders.slice(-MAX_VISIBLE).reverse();
	const hidden = reminders.length - visible.length;

	return (
		<div
			className="fixed bottom-4 left-4 z-[90] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
			role="region"
			aria-label="Calendar reminders"
			aria-live="polite"
		>
			{visible.map((reminder) => (
				<ReminderToast key={reminder.id} reminder={reminder} />
			))}
			{hidden > 0 && (
				<Link
					href="/calendar"
					className="self-start rounded-full bg-white px-3 py-1 text-xs font-medium text-neutral-600 shadow-md ring-1 ring-neutral-200 hover:text-primary"
				>
					{hidden} more {hidden === 1 ? "reminder" : "reminders"}
				</Link>
			)}
		</div>
	);
}

function ReminderToast({ reminder }: { reminder: CalendarReminderRecord }) {
	const { dismiss, snooze, pending } = useReminderActions(reminder);
	return (
		<div className="rounded-xl border border-amber-200 bg-white p-3.5 shadow-xl">
			<div className="flex items-start gap-3">
				<div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
					<BellRing className="size-4" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-xs font-medium text-amber-700">
						Reminder · {formatTime(reminder.remindAt)}
					</p>
					<p className="mt-0.5 truncate text-sm font-semibold text-neutral-900">{reminder.title}</p>
					{reminder.message && (
						<p className="mt-0.5 line-clamp-2 text-xs text-neutral-600">{reminder.message}</p>
					)}
					<div className="mt-2.5 flex flex-wrap items-center gap-1.5">
						<SnoozeMenu size="xs" disabled={pending} onSnooze={(until) => snooze.mutate(until)} />
						<Link href="/calendar" className={buttonVariants({ size: "xs", variant: "ghost" })}>
							Open calendar
						</Link>
					</div>
				</div>
				<button
					type="button"
					disabled={pending}
					onClick={() => dismiss.mutate()}
					className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50"
				>
					<X className="size-4" />
					<span className="sr-only">Dismiss reminder</span>
				</button>
			</div>
		</div>
	);
}
