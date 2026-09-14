"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlarmClock,
	Bell,
	CalendarDays,
	Ellipsis,
	History,
	ListTodo,
	Mail,
	Pencil,
	X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
	calendarKeys,
	cancelCalendarReminder,
	dismissCalendarReminder,
	listCalendarReminderDeliveries,
	snoozeCalendarReminder,
} from "@/lib/calendar/client";
import type { CalendarReminderRecord } from "@/lib/calendar/types";
import {
	browserTimezone,
	formatDateTime,
	instantToWallClock,
	toOffsetDateTime,
	wallClockToInstant,
} from "@/lib/calendar/wall-clock";
import { cn } from "@/lib/utils";
import { FormError } from "./calendar-fields";
import {
	REMINDER_STATUS_STYLES,
	errorMessage,
	reminderActions,
	snoozeChoices,
} from "./calendar-utils";

export function useReminderActions(reminder: CalendarReminderRecord) {
	const queryClient = useQueryClient();
	const refresh = () => queryClient.invalidateQueries({ queryKey: calendarKeys.all });
	const onError = (error: unknown) =>
		toast.add({ title: "Reminder not updated", description: errorMessage(error), type: "error" });

	const dismiss = useMutation({
		mutationFn: () => dismissCalendarReminder(reminder.id),
		onSuccess: refresh,
		onError,
	});
	const cancel = useMutation({
		mutationFn: () => cancelCalendarReminder(reminder.id),
		onSuccess: async () => {
			await refresh();
			toast.add({ title: "Reminder cancelled", type: "success" });
		},
		onError,
	});
	const snooze = useMutation({
		mutationFn: (until: Date) =>
			snoozeCalendarReminder(reminder.id, toOffsetDateTime(until, browserTimezone())),
		onSuccess: async (updated) => {
			await refresh();
			toast.add({ title: `Snoozed until ${formatDateTime(updated.remindAt)}`, type: "success" });
		},
		onError,
	});
	return {
		dismiss,
		cancel,
		snooze,
		pending: dismiss.isPending || cancel.isPending || snooze.isPending,
	};
}

export function SnoozeMenu({
	onSnooze,
	disabled,
	size = "sm",
	variant = "outline",
}: {
	onSnooze: (until: Date) => void;
	disabled?: boolean;
	size?: "xs" | "sm";
	variant?: "outline" | "ghost";
}) {
	const [customOpen, setCustomOpen] = useState(false);
	const [customAt, setCustomAt] = useState("");
	const [error, setError] = useState<string | null>(null);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					disabled={disabled}
					render={<Button type="button" variant={variant} size={size} />}
				>
					<AlarmClock />
					Snooze
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					{snoozeChoices().map((choice) => (
						<DropdownMenuItem key={choice.id} onClick={() => onSnooze(choice.at)}>
							<span className="flex-1">{choice.label}</span>
							<span className="text-xs text-neutral-400">
								{choice.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
							</span>
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => {
							const later = new Date(Date.now() + 2 * 3_600_000);
							setCustomAt(instantToWallClock(later, browserTimezone()));
							setError(null);
							setCustomOpen(true);
						}}
					>
						Pick date & time…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={customOpen} onOpenChange={setCustomOpen}>
				<DialogContent className="sm:max-w-sm">
					<form
						className="flex min-h-0 flex-1 flex-col"
						onSubmit={(event) => {
							event.preventDefault();
							const until = customAt ? wallClockToInstant(customAt, browserTimezone()) : null;
							if (!until || until <= new Date()) {
								setError("Choose a time in the future.");
								return;
							}
							onSnooze(until);
							setCustomOpen(false);
						}}
					>
						<DialogHeader>
							<DialogTitle>Snooze until</DialogTitle>
							<DialogDescription>In your timezone, {browserTimezone()}.</DialogDescription>
						</DialogHeader>
						<DialogBody className="space-y-3">
							<Input
								type="datetime-local"
								required
								value={customAt}
								onChange={(event) => setCustomAt(event.target.value)}
								aria-label="Snooze until"
							/>
							<FormError message={error} />
						</DialogBody>
						<DialogFooter>
							<Button type="button" variant="ghost" onClick={() => setCustomOpen(false)}>
								Cancel
							</Button>
							<Button type="submit">Snooze</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

export function ReminderStatusBadge({ reminder }: { reminder: CalendarReminderRecord }) {
	const style = REMINDER_STATUS_STYLES[reminder.status];
	return (
		<span
			className={cn(
				"inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium",
				style.className,
			)}
		>
			{style.label}
		</span>
	);
}

export function ReminderRow({
	reminder,
	onEdit,
	onOpenTarget,
	taskCompleted = false,
}: {
	reminder: CalendarReminderRecord;
	onEdit?: (reminder: CalendarReminderRecord) => void;
	/** Shown where the reminder appears outside its event or task. */
	onOpenTarget?: (reminder: CalendarReminderRecord) => void;
	/** A completed task's reminders can't be rescheduled until it is reopened. */
	taskCompleted?: boolean;
}) {
	const [historyOpen, setHistoryOpen] = useState(false);
	const available = reminderActions(reminder);
	const actions = taskCompleted
		? { ...available, edit: false, snooze: false, cancel: false }
		: available;
	const { dismiss, cancel, snooze, pending } = useReminderActions(reminder);
	const ChannelIcon = reminder.channel === "email" ? Mail : Bell;

	return (
		<div className="group flex gap-3 rounded-lg px-2 py-2.5 hover:bg-neutral-50">
			<div
				className={cn(
					"mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
					reminder.status === "delivered"
						? "bg-amber-100 text-amber-700"
						: reminder.status === "failed"
							? "bg-red-50 text-red-600"
							: "bg-neutral-100 text-neutral-500",
				)}
			>
				<ChannelIcon className="size-4" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-start gap-2">
					<p
						className={cn(
							"min-w-0 flex-1 truncate text-sm font-medium",
							reminder.status === "cancelled"
								? "text-neutral-400 line-through"
								: "text-neutral-900",
						)}
					>
						{reminder.title}
					</p>
					<ReminderStatusBadge reminder={reminder} />
				</div>
				<p className="mt-0.5 text-xs text-neutral-500">
					{formatDateTime(reminder.remindAt)}
					{reminder.channel === "email" && reminder.recipient && ` · to ${reminder.recipient}`}
				</p>
				{reminder.snoozedUntil && reminder.status === "scheduled" && (
					<p className="mt-0.5 text-xs text-neutral-500">Snoozed</p>
				)}
				{reminder.message && (
					<p className="mt-1 line-clamp-2 text-xs whitespace-pre-line text-neutral-600">
						{reminder.message}
					</p>
				)}
				{reminder.lastError && reminder.status !== "delivered" && (
					<p className="mt-1 text-xs text-red-600">
						{reminder.status === "failed" ? "Gave up" : "Retrying"} after {reminder.attemptCount}{" "}
						{reminder.attemptCount === 1 ? "attempt" : "attempts"}: {reminder.lastError}
					</p>
				)}
				{(actions.dismiss || actions.snooze) && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{actions.dismiss && (
							<Button
								type="button"
								size="xs"
								variant="outline"
								disabled={pending}
								onClick={() => dismiss.mutate()}
							>
								<X />
								Dismiss
							</Button>
						)}
						{actions.snooze && reminder.status !== "scheduled" && (
							<SnoozeMenu size="xs" disabled={pending} onSnooze={(until) => snooze.mutate(until)} />
						)}
					</div>
				)}
			</div>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="mt-0.5 text-neutral-500"
							aria-label="Reminder actions"
						/>
					}
				>
					<Ellipsis />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-48">
					{actions.edit && onEdit && (
						<DropdownMenuItem onClick={() => onEdit(reminder)}>
							<Pencil />
							{reminder.status === "scheduled" ? "Edit" : "Reschedule"}
						</DropdownMenuItem>
					)}
					{actions.snooze && reminder.status === "scheduled" && (
						<DropdownMenuItem
							onClick={() => snooze.mutate(snoozeChoices()[1].at)}
							disabled={pending}
						>
							<AlarmClock />
							Remind me in 1 hour
						</DropdownMenuItem>
					)}
					{onOpenTarget && (
						<DropdownMenuItem onClick={() => onOpenTarget(reminder)}>
							{reminder.eventId ? <CalendarDays /> : <ListTodo />}
							{reminder.eventId ? "Open event" : "Open task"}
						</DropdownMenuItem>
					)}
					<DropdownMenuItem onClick={() => setHistoryOpen(true)}>
						<History />
						Delivery history
					</DropdownMenuItem>
					{actions.cancel && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								disabled={pending}
								onClick={() => cancel.mutate()}
							>
								<X />
								Cancel reminder
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			<DeliveryHistoryDialog reminder={reminder} open={historyOpen} onOpenChange={setHistoryOpen} />
		</div>
	);
}

const DELIVERY_STATUS: Record<string, { label: string; className: string }> = {
	delivered: { label: "Delivered", className: "bg-green-50 text-green-700" },
	queued: { label: "Email queued", className: "bg-sky-50 text-sky-700" },
	failed: { label: "Failed", className: "bg-red-50 text-red-700" },
};

function DeliveryHistoryDialog({
	reminder,
	open,
	onOpenChange,
}: {
	reminder: CalendarReminderRecord;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const deliveries = useQuery({
		queryKey: calendarKeys.deliveries(reminder.id),
		queryFn: () => listCalendarReminderDeliveries(reminder.id),
		enabled: open,
		refetchOnMount: "always",
	});
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Delivery history</DialogTitle>
					<DialogDescription className="truncate">{reminder.title}</DialogDescription>
				</DialogHeader>
				<DialogBody>
					{deliveries.isPending ? (
						<p className="py-6 text-center text-sm text-neutral-500">Loading history…</p>
					) : deliveries.isError ? (
						<FormError message={errorMessage(deliveries.error)} />
					) : deliveries.data.length === 0 ? (
						<p className="rounded-lg border border-dashed border-neutral-200 px-4 py-6 text-center text-sm text-neutral-500">
							Nothing has been delivered yet. Delivery attempts appear here once the reminder is
							due.
						</p>
					) : (
						<ol className="space-y-2">
							{deliveries.data.map((delivery) => {
								const status = DELIVERY_STATUS[delivery.status];
								return (
									<li
										key={delivery.id}
										className="rounded-lg border border-neutral-200 px-3 py-2.5"
									>
										<div className="flex items-center gap-2">
											<span className="flex-1 text-sm font-medium text-neutral-900">
												Scheduled for {formatDateTime(delivery.scheduledFor)}
											</span>
											<span
												className={cn(
													"inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium",
													status?.className,
												)}
											>
												{status?.label ?? delivery.status}
											</span>
										</div>
										<dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-neutral-600">
											<dt className="text-neutral-400">Channel</dt>
											<dd>{delivery.channel === "email" ? "Email" : "In-app"}</dd>
											<dt className="text-neutral-400">Attempts</dt>
											<dd>{delivery.attemptCount}</dd>
											{delivery.deliveredAt && (
												<>
													<dt className="text-neutral-400">
														{delivery.channel === "email" ? "Queued" : "Delivered"}
													</dt>
													<dd>{formatDateTime(delivery.deliveredAt)}</dd>
												</>
											)}
											{delivery.messageId && (
												<>
													<dt className="text-neutral-400">Message</dt>
													<dd className="truncate font-mono">{delivery.messageId}</dd>
												</>
											)}
											{delivery.error && (
												<>
													<dt className="text-neutral-400">Error</dt>
													<dd className="text-red-600">{delivery.error}</dd>
												</>
											)}
										</dl>
									</li>
								);
							})}
						</ol>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}
