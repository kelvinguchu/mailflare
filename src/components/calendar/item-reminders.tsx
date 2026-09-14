"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calendarKeys, listCalendarReminders } from "@/lib/calendar/client";
import type { CalendarReminderRecord } from "@/lib/calendar/types";
import type { ReminderDialogState, ReminderTarget } from "./calendar-types";
import { errorMessage } from "./calendar-utils";
import { ReminderDialog } from "./reminder-dialog";
import { ReminderRow } from "./reminder-row";

/**
 * Reminders attached to one event or task, including past and cancelled ones. The
 * reminder dialog renders inside this tree so it nests in the item's dialog.
 */
export function ItemReminders({ target }: { target: ReminderTarget }) {
	const [dialog, setDialog] = useState<ReminderDialogState | null>(null);
	const params =
		target.kind === "event"
			? { status: "all" as const, eventId: target.id }
			: { status: "all" as const, taskId: target.id };
	const reminders = useQuery({
		queryKey: calendarKeys.reminders(params),
		queryFn: () => listCalendarReminders(params),
		refetchOnMount: "always",
	});
	const items = [...(reminders.data ?? [])].sort((a, b) => {
		const active = (reminder: CalendarReminderRecord) =>
			reminder.status === "cancelled" || reminder.status === "dismissed" ? 1 : 0;
		return active(a) - active(b) || a.remindAt.localeCompare(b.remindAt);
	});

	const isTask = target.kind === "task";
	let emptyText = "No reminders yet.";
	if (target.locked) emptyText = "Completed tasks can’t have reminders.";
	else if (isTask) emptyText = "No reminders yet. Only you are notified by the reminders you add.";

	return (
		<section className="space-y-1" aria-labelledby={`reminders-${target.id}`}>
			<div className="flex items-center justify-between gap-3">
				<h3
					id={`reminders-${target.id}`}
					className="text-xs font-medium tracking-wide text-neutral-500 uppercase"
				>
					{isTask ? "Your reminders" : "Reminders"}
				</h3>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					onClick={() => setDialog({ target })}
					disabled={target.locked}
					aria-describedby={target.locked ? `reminders-note-${target.id}` : undefined}
				>
					<BellPlus />
					Add
				</Button>
			</div>
			{reminders.isPending && <p className="py-2 text-sm text-neutral-400">Loading reminders…</p>}
			{reminders.isError && (
				<p className="py-2 text-sm text-red-600">{errorMessage(reminders.error)}</p>
			)}
			{reminders.isSuccess && items.length === 0 && (
				<p className="py-2 text-sm text-neutral-500">{emptyText}</p>
			)}
			{items.length > 0 && (
				<div className="-mx-2">
					{items.map((reminder) => (
						<ReminderRow
							key={reminder.id}
							reminder={reminder}
							taskCompleted={isTask && target.locked}
							onEdit={(item) => setDialog({ target, reminder: item })}
						/>
					))}
				</div>
			)}
			{isTask && (
				<p id={`reminders-note-${target.id}`} className="text-xs text-neutral-500">
					{target.locked
						? "Completing this task cancelled its pending reminders. Reopening it won’t restore them; add a new reminder after reopening."
						: "Completing this task cancels its pending reminders, including queued reminder emails."}
				</p>
			)}
			<ReminderDialog state={dialog} onClose={() => setDialog(null)} />
		</section>
	);
}
