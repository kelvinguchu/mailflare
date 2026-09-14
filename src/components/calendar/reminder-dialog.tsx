"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Mail } from "lucide-react";
import { useSelectedMailbox } from "@/components/mailbox-provider";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	calendarKeys,
	createCalendarReminder,
	updateCalendarReminder,
} from "@/lib/calendar/client";
import type { CalendarReminderChannel } from "@/lib/calendar/types";
import {
	browserTimezone,
	formatDateTime,
	instantToWallClock,
	toOffsetDateTime,
	wallClockToInstant,
} from "@/lib/calendar/wall-clock";
import { cn } from "@/lib/utils";
import { FormError, SenderSelect, TimezoneSelect } from "./calendar-fields";
import type { ReminderDialogState } from "./calendar-types";
import {
	errorMessage,
	findSenderOption,
	nextHalfHour,
	reminderChoices,
	senderOptions,
} from "./calendar-utils";

const CUSTOM = "custom";

export function ReminderDialog({
	state,
	onClose,
}: {
	state: ReminderDialogState | null;
	onClose: () => void;
}) {
	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
			{state && (
				<DialogContent className="sm:max-w-lg">
					<ReminderForm
						key={`${state.target.id}-${state.reminder?.id ?? "new"}`}
						state={state}
						onClose={onClose}
					/>
				</DialogContent>
			)}
		</Dialog>
	);
}

function ReminderForm({ state, onClose }: { state: ReminderDialogState; onClose: () => void }) {
	const { target, reminder } = state;
	const queryClient = useQueryClient();
	const { mailboxes, selectedMailbox } = useSelectedMailbox();
	const senders = useMemo(() => senderOptions(mailboxes), [mailboxes]);
	const choices = useMemo(() => reminderChoices(target), [target]);

	const initialTimezone = reminder?.timezone ?? target.timezone ?? browserTimezone();
	const [choice, setChoice] = useState(reminder ? CUSTOM : (choices[0]?.id ?? CUSTOM));
	const [timezone, setTimezone] = useState(initialTimezone);
	const [customAt, setCustomAt] = useState(() =>
		instantToWallClock(reminder?.remindAt ?? choices[0]?.at ?? nextHalfHour(), initialTimezone),
	);
	const [channel, setChannel] = useState<CalendarReminderChannel>(reminder?.channel ?? "in_app");
	const defaultSender =
		findSenderOption(senders, reminder?.mailboxId, reminder?.fromAddr) ??
		senders.find((option) => option.mailboxId === selectedMailbox?.id) ??
		senders[0];
	const [senderKey, setSenderKey] = useState(defaultSender?.key ?? "");
	const [recipient, setRecipient] = useState(reminder?.recipient ?? defaultSender?.address ?? "");
	const [title, setTitle] = useState(reminder?.title ?? "");
	const [message, setMessage] = useState(reminder?.message ?? "");

	const save = useMutation({
		mutationFn: async () => {
			const at =
				choice === CUSTOM
					? wallClockToInstant(customAt, timezone)
					: choices.find((item) => item.id === choice)?.at;
			if (!at || Number.isNaN(at.getTime())) throw new Error("Choose when to be reminded");
			const sender = senders.find((option) => option.key === senderKey);
			if (channel === "email" && !sender) throw new Error("Choose a sender address");
			const fields = {
				title: title.trim() || target.title,
				message,
				channel,
				remindAt: toOffsetDateTime(at, timezone),
				timezone,
				...(channel === "email"
					? { mailboxId: sender?.mailboxId, from: sender?.address, recipient: recipient.trim() }
					: {}),
			};
			return reminder
				? updateCalendarReminder(reminder.id, fields)
				: createCalendarReminder({
						...fields,
						eventId: target.kind === "event" ? target.id : null,
						taskId: target.kind === "task" ? target.id : null,
					});
		},
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: calendarKeys.all });
			onClose();
		},
	});

	const selectedAt =
		choice === CUSTOM ? null : (choices.find((item) => item.id === choice)?.at ?? null);

	return (
		<form
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				save.mutate();
			}}
		>
			<DialogHeader>
				<DialogTitle>{reminder ? "Edit reminder" : "Add reminder"}</DialogTitle>
				<DialogDescription className="truncate">For “{target.title}”</DialogDescription>
			</DialogHeader>
			<DialogBody className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="reminder-when">Remind me</Label>
					{choices.length > 0 && (
						<Select value={choice} onValueChange={(next) => next && setChoice(next)}>
							<SelectTrigger id="reminder-when" className="w-full">
								<SelectValue>
									{(value: string) =>
										value === CUSTOM
											? "At a specific time"
											: choices.find((item) => item.id === value)?.label
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent alignItemWithTrigger={false}>
								{choices.map((item) => (
									<SelectItem key={item.id} value={item.id}>
										{item.label}
									</SelectItem>
								))}
								<SelectItem value={CUSTOM}>At a specific time</SelectItem>
							</SelectContent>
						</Select>
					)}
					{selectedAt && <p className="text-xs text-neutral-500">{formatDateTime(selectedAt)}</p>}
					{choice === CUSTOM && (
						<div className="grid gap-2 sm:grid-cols-2">
							<Input
								id={choices.length ? undefined : "reminder-when"}
								type="datetime-local"
								required
								value={customAt}
								onChange={(event) => setCustomAt(event.target.value)}
								aria-label="Reminder date and time"
							/>
							<TimezoneSelect value={timezone} onChange={setTimezone} />
						</div>
					)}
				</div>

				<div className="space-y-2">
					<Label>Deliver as</Label>
					<div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Reminder channel">
						{(
							[
								{ value: "in_app", label: "In-app alert", icon: Bell },
								{ value: "email", label: "Email", icon: Mail },
							] as const
						).map((option) => (
							<button
								key={option.value}
								type="button"
								role="radio"
								aria-checked={channel === option.value}
								disabled={option.value === "email" && senders.length === 0}
								onClick={() => setChannel(option.value)}
								className={cn(
									"flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
									channel === option.value
										? "border-primary bg-primary/6 text-primary"
										: "border-neutral-200 text-neutral-600 hover:bg-neutral-50",
								)}
							>
								<option.icon className="size-4" />
								{option.label}
							</button>
						))}
					</div>
				</div>

				{channel === "email" && (
					<div className="grid gap-3 rounded-lg bg-neutral-50 p-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="reminder-from">Send from</Label>
							<SenderSelect
								id="reminder-from"
								options={senders}
								value={senderKey}
								onChange={setSenderKey}
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="reminder-to">Send to</Label>
							<Input
								id="reminder-to"
								type="email"
								required
								value={recipient}
								onChange={(event) => setRecipient(event.target.value)}
								className="bg-white"
							/>
						</div>
					</div>
				)}

				<div className="space-y-2">
					<Label htmlFor="reminder-title">Title</Label>
					<Input
						id="reminder-title"
						value={title}
						maxLength={200}
						onChange={(event) => setTitle(event.target.value)}
						placeholder={target.title}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="reminder-message">Note</Label>
					<Textarea
						id="reminder-message"
						value={message}
						maxLength={5000}
						rows={3}
						onChange={(event) => setMessage(event.target.value)}
						placeholder="Optional details to include with the reminder"
					/>
				</div>
				<FormError message={save.isError ? errorMessage(save.error) : null} />
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
					Cancel
				</Button>
				<Button type="submit" disabled={save.isPending}>
					{save.isPending ? "Saving..." : reminder ? "Save reminder" : "Add reminder"}
				</Button>
			</DialogFooter>
		</form>
	);
}
