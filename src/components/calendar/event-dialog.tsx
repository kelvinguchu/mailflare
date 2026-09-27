"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AlignLeft,
	CalendarClock,
	CalendarDays,
	Globe,
	MapPin,
	Pencil,
	Trash2,
	UsersRound,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import {
	calendarKeys,
	deleteCalendarEvent,
	parseEventAttendees,
	saveCalendarEvent,
} from "@/lib/calendar/client";
import type { CalendarEventInput, CalendarEventRecord } from "@/lib/calendar/types";
import {
	addDaysToKey,
	browserTimezone,
	dateKey,
	formatEventWhen,
	formatTime,
	instantToWallClock,
	timezoneLabel,
	toOffsetDateTime,
	utcDateKey,
	wallClockToInstant,
} from "@/lib/calendar/wall-clock";
import { AdvisoryReschedule } from "./advisory-reschedule";
import { FormError, GuestInput, SenderSelect, TimezoneSelect } from "./calendar-fields";
import type { EventDialogState, EventDraft, ReminderTarget } from "./calendar-types";
import { errorMessage, findSenderOption, senderOptions } from "./calendar-utils";
import { ItemReminders } from "./item-reminders";

type EventDialogProps = {
	state: EventDialogState | null;
	onStateChange: (state: EventDialogState | null) => void;
};

export function EventDialog({ state, onStateChange }: EventDialogProps) {
	const [editing, setEditing] = useState(false);
	const close = () => {
		setEditing(false);
		onStateChange(null);
	};
	const showForm = state?.mode === "create" || editing;

	return (
		<Dialog open={state !== null} onOpenChange={(open) => !open && close()}>
			{state && (
				<DialogContent className="sm:max-w-xl">
					{showForm ? (
						<EventForm
							key={state.mode === "view" ? state.event.id : "new"}
							event={state.mode === "view" ? state.event : null}
							draft={state.mode === "create" ? state.draft : null}
							onCancel={() => (state.mode === "view" ? setEditing(false) : close())}
							onSaved={(event) => {
								setEditing(false);
								onStateChange({ mode: "view", event });
							}}
						/>
					) : (
						state.mode === "view" && (
							<EventDetails
								key={`${state.event.id}:${state.event.startsAt}`}
								event={state.event}
								onEdit={() => setEditing(true)}
								onDeleted={close}
								onRescheduled={(event) => onStateChange({ mode: "view", event })}
							/>
						)
					)}
				</DialogContent>
			)}
		</Dialog>
	);
}

function eventReminderTarget(event: CalendarEventRecord): ReminderTarget {
	return {
		kind: "event",
		id: event.id,
		title: event.title,
		timezone: event.timezone,
		anchor: { value: event.startsAt, allDay: event.allDay },
	};
}

function EventDetails({
	event,
	onEdit,
	onDeleted,
	onRescheduled,
}: {
	event: CalendarEventRecord;
	onEdit: () => void;
	onDeleted: () => void;
	onRescheduled: (event: CalendarEventRecord) => void;
}) {
	const queryClient = useQueryClient();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const deleteKey = useRef(crypto.randomUUID());
	const attendees = parseEventAttendees(event);
	const target = eventReminderTarget(event);
	const differentZone = !event.allDay && event.timezone !== browserTimezone();
	const managedByCaliberCode = /^cc_(advisory_\d+|event_[a-z0-9]+)$/i.test(event.id);
	// Paid advisory sessions can be moved; the CMS then emails the client.
	const reschedulable = /^cc_advisory_\d+$/.test(event.id);
	const [rescheduling, setRescheduling] = useState(false);

	const remove = useMutation({
		mutationFn: () => deleteCalendarEvent(event.id, deleteKey.current),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: calendarKeys.all });
			toast.add({
				title: "Event deleted",
				description: attendees.length ? "Guests will receive a cancellation notice." : undefined,
				type: "success",
			});
			onDeleted();
		},
	});

	return (
		<>
			<DialogHeader>
				<DialogTitle className="text-lg leading-snug">{event.title}</DialogTitle>
				<DialogDescription>{formatEventWhen(event)}</DialogDescription>
				{differentZone && (
					<p className="text-xs text-neutral-500">
						{formatTime(event.startsAt, event.timezone)} –{" "}
						{formatTime(event.endsAt, event.timezone)} in{" "}
						{timezoneLabel(event.timezone, new Date(event.startsAt))}
					</p>
				)}
			</DialogHeader>
			<DialogBody className="space-y-5">
				{(event.location || attendees.length > 0 || event.description) && (
					<div className="space-y-3 text-sm text-neutral-700">
						{event.location && (
							<DetailLine icon={MapPin}>
								<span className="break-words">{event.location}</span>
							</DetailLine>
						)}
						{attendees.length > 0 && (
							<DetailLine icon={UsersRound}>
								<p className="font-medium text-neutral-900">
									{attendees.length} {attendees.length === 1 ? "guest" : "guests"}
								</p>
								{event.organizer && (
									<p className="text-xs text-neutral-500">
										Invitations sent from {event.organizer}
									</p>
								)}
								<ul className="mt-1.5 space-y-0.5">
									{attendees.map((attendee) => (
										<li key={attendee} className="truncate">
											{attendee}
										</li>
									))}
								</ul>
							</DetailLine>
						)}
						{event.description && (
							<DetailLine icon={AlignLeft}>
								<p className="whitespace-pre-wrap break-words">{event.description}</p>
							</DetailLine>
						)}
					</div>
				)}
				{managedByCaliberCode ? (
					<p className="text-xs text-neutral-500">Managed by CaliberCode · reminder 24 hours before</p>
				) : <ItemReminders target={target} />}
				{rescheduling && (
					<AdvisoryReschedule
						event={event}
						onCancel={() => setRescheduling(false)}
						onRescheduled={onRescheduled}
					/>
				)}
				<FormError message={remove.isError ? errorMessage(remove.error) : null} />
			</DialogBody>
			{reschedulable && !rescheduling && (
				<DialogFooter className="items-center">
					<Button type="button" onClick={() => setRescheduling(true)}>
						<CalendarClock />
						Reschedule
					</Button>
				</DialogFooter>
			)}
			{!managedByCaliberCode && <DialogFooter className="items-center">
				{confirmingDelete ? (
					<>
						<p className="mr-auto text-sm text-neutral-600">
							Delete this event?
							{attendees.length > 0 && " Guests will be sent a cancellation."}
						</p>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setConfirmingDelete(false)}
							disabled={remove.isPending}
						>
							Keep
						</Button>
						<Button
							type="button"
							variant="destructive"
							onClick={() => remove.mutate()}
							disabled={remove.isPending}
						>
							{remove.isPending ? "Deleting..." : "Delete event"}
						</Button>
					</>
				) : (
					<>
						<Button
							type="button"
							variant="ghost"
							className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700"
							onClick={() => setConfirmingDelete(true)}
						>
							<Trash2 />
							Delete
						</Button>
						<Button type="button" onClick={onEdit}>
							<Pencil />
							Edit event
						</Button>
					</>
				)}
			</DialogFooter>}
		</>
	);
}

function DetailLine({ icon: Icon, children }: { icon: typeof MapPin; children: React.ReactNode }) {
	return (
		<div className="flex gap-3">
			<Icon className="mt-0.5 size-4 shrink-0 text-neutral-400" />
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

type EventFormValues = {
	title: string;
	allDay: boolean;
	start: string;
	end: string;
	startDate: string;
	endDate: string;
	timezone: string;
	location: string;
	description: string;
	guests: string[];
	senderKey: string;
};

function initialValues(
	event: CalendarEventRecord | null,
	draft: EventDraft | null,
	senderKey: string,
): EventFormValues {
	if (event) {
		const timezone = event.timezone || browserTimezone();
		const startDate = event.allDay ? utcDateKey(event.startsAt) : dateKey(new Date(event.startsAt));
		const endDate = event.allDay
			? addDaysToKey(utcDateKey(event.endsAt), -1)
			: dateKey(new Date(event.endsAt));
		return {
			title: event.title,
			allDay: event.allDay,
			start: event.allDay ? `${startDate}T09:00` : instantToWallClock(event.startsAt, timezone),
			end: event.allDay ? `${endDate}T10:00` : instantToWallClock(event.endsAt, timezone),
			startDate,
			endDate: endDate < startDate ? startDate : endDate,
			timezone,
			location: event.location,
			description: event.description,
			guests: parseEventAttendees(event),
			senderKey,
		};
	}
	const timezone = browserTimezone();
	const start = draft?.start ?? new Date();
	const end = draft?.end ?? new Date(start.getTime() + 3_600_000);
	return {
		title: "",
		allDay: draft?.allDay ?? false,
		start: instantToWallClock(start, timezone),
		end: instantToWallClock(end, timezone),
		startDate: dateKey(start),
		endDate: dateKey(end),
		timezone,
		location: "",
		description: "",
		guests: [],
		senderKey,
	};
}

function EventForm({
	event,
	draft,
	onCancel,
	onSaved,
}: {
	event: CalendarEventRecord | null;
	draft: EventDraft | null;
	onCancel: () => void;
	onSaved: (event: CalendarEventRecord) => void;
}) {
	const queryClient = useQueryClient();
	const { mailboxes, selectedMailbox } = useSelectedMailbox();
	const senders = useMemo(() => senderOptions(mailboxes), [mailboxes]);
	const defaultSender =
		findSenderOption(senders, event?.mailboxId, event?.organizer) ??
		senders.find((option) => option.mailboxId === selectedMailbox?.id) ??
		senders[0];
	const [values, setValues] = useState(() => initialValues(event, draft, defaultSender?.key ?? ""));
	const [showTimezone, setShowTimezone] = useState(() => values.timezone !== browserTimezone());
	const [validation, setValidation] = useState<string | null>(null);
	// Retries of an unchanged submission reuse the key so invitations are never sent twice.
	const idempotency = useRef<{ payload: string; key: string } | null>(null);

	const set = <Key extends keyof EventFormValues>(key: Key, value: EventFormValues[Key]) => {
		setValidation(null);
		setValues((current) => ({ ...current, [key]: value }));
	};

	function changeStart(start: string) {
		setValidation(null);
		setValues((current) => {
			try {
				const duration =
					wallClockToInstant(current.end, current.timezone).getTime() -
					wallClockToInstant(current.start, current.timezone).getTime();
				const nextEnd = new Date(
					wallClockToInstant(start, current.timezone).getTime() + Math.max(duration, 0),
				);
				return { ...current, start, end: instantToWallClock(nextEnd, current.timezone) };
			} catch {
				return { ...current, start };
			}
		});
	}

	function changeStartDate(startDate: string) {
		setValidation(null);
		setValues((current) => {
			if (!startDate || !current.startDate || !current.endDate) return { ...current, startDate };
			const span = Math.max(
				0,
				Math.round((Date.parse(current.endDate) - Date.parse(current.startDate)) / 86_400_000),
			);
			return { ...current, startDate, endDate: addDaysToKey(startDate, span) };
		});
	}

	function toggleAllDay(allDay: boolean) {
		setValidation(null);
		setValues((current) =>
			allDay
				? {
						...current,
						allDay,
						startDate: current.start.slice(0, 10),
						endDate: current.end.slice(0, 10),
					}
				: {
						...current,
						allDay,
						start: `${current.startDate}T${current.start.slice(11, 16) || "09:00"}`,
						end: `${current.endDate}T${current.end.slice(11, 16) || "10:00"}`,
					},
		);
	}

	function buildInput(): CalendarEventInput {
		const title = values.title.trim();
		if (!title) throw new Error("Add a title for the event.");
		let startsAt: string;
		let endsAt: string;
		if (values.allDay) {
			if (!values.startDate || !values.endDate) throw new Error("Choose the event dates.");
			if (values.endDate < values.startDate)
				throw new Error("The event must end on or after its first day.");
			startsAt = values.startDate;
			endsAt = addDaysToKey(values.endDate, 1);
		} else {
			if (!values.start || !values.end) throw new Error("Choose when the event starts and ends.");
			const start = wallClockToInstant(values.start, values.timezone);
			const end = wallClockToInstant(values.end, values.timezone);
			if (end <= start) throw new Error("The event must end after it starts.");
			startsAt = toOffsetDateTime(start, values.timezone);
			endsAt = toOffsetDateTime(end, values.timezone);
		}
		const input: CalendarEventInput = {
			title,
			description: values.description,
			location: values.location,
			attendees: values.guests,
			startsAt,
			endsAt,
			timezone: values.timezone,
			allDay: values.allDay,
		};
		if (values.guests.length > 0) {
			const sender = senders.find((option) => option.key === values.senderKey);
			if (!sender) throw new Error("Choose which address sends the invitations.");
			input.mailboxId = sender.mailboxId;
			input.from = sender.address;
		}
		return input;
	}

	const save = useMutation({
		mutationFn: async (input: CalendarEventInput) => {
			const payload = JSON.stringify([event?.id ?? null, input]);
			if (idempotency.current?.payload !== payload) {
				idempotency.current = { payload, key: crypto.randomUUID() };
			}
			return saveCalendarEvent(event?.id ?? null, input, idempotency.current.key);
		},
		onSuccess: async (saved, input) => {
			idempotency.current = null;
			await queryClient.invalidateQueries({ queryKey: calendarKeys.all });
			if (input.attendees?.length) {
				toast.add({
					title: event ? "Event updated" : "Event created",
					description: `${event ? "Updates" : "Invitations"} sent to ${input.attendees.length} ${
						input.attendees.length === 1 ? "guest" : "guests"
					}.`,
					type: "success",
				});
			}
			onSaved(saved);
		},
	});

	return (
		<form
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(submitEvent) => {
				submitEvent.preventDefault();
				try {
					save.mutate(buildInput());
				} catch (error) {
					setValidation(errorMessage(error));
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
				<DialogDescription className="sr-only">
					{event ? "Change the event details." : "Add an event to your calendar."}
				</DialogDescription>
			</DialogHeader>
			<DialogBody className="space-y-4">
				<Input
					aria-label="Event title"
					placeholder="Add title"
					value={values.title}
					maxLength={200}
					onChange={(changeEvent) => set("title", changeEvent.target.value)}
					className="h-11 border-0 border-b border-neutral-200 rounded-none px-0 text-lg shadow-none focus-visible:border-primary focus-visible:ring-0"
				/>

				<div className="space-y-3 rounded-xl bg-neutral-50 p-3">
					<div className="flex items-center justify-between gap-3">
						<Label htmlFor="event-all-day" className="gap-2 font-normal text-neutral-700">
							<CalendarDays className="size-4 text-neutral-400" />
							All day
						</Label>
						<Switch id="event-all-day" checked={values.allDay} onCheckedChange={toggleAllDay} />
					</div>
					{values.allDay ? (
						<div className="grid gap-2 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="event-start-date" className="text-xs text-neutral-500">
									Starts
								</Label>
								<Input
									id="event-start-date"
									type="date"
									required
									value={values.startDate}
									onChange={(changeEvent) => changeStartDate(changeEvent.target.value)}
									className="bg-white"
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="event-end-date" className="text-xs text-neutral-500">
									Ends
								</Label>
								<Input
									id="event-end-date"
									type="date"
									required
									min={values.startDate}
									value={values.endDate}
									onChange={(changeEvent) => set("endDate", changeEvent.target.value)}
									className="bg-white"
								/>
							</div>
						</div>
					) : (
						<>
							<div className="grid gap-2 sm:grid-cols-2">
								<div className="space-y-1">
									<Label htmlFor="event-start" className="text-xs text-neutral-500">
										Starts
									</Label>
									<Input
										id="event-start"
										type="datetime-local"
										required
										value={values.start}
										onChange={(changeEvent) => changeStart(changeEvent.target.value)}
										className="bg-white"
									/>
								</div>
								<div className="space-y-1">
									<Label htmlFor="event-end" className="text-xs text-neutral-500">
										Ends
									</Label>
									<Input
										id="event-end"
										type="datetime-local"
										required
										min={values.start}
										value={values.end}
										onChange={(changeEvent) => set("end", changeEvent.target.value)}
										className="bg-white"
									/>
								</div>
							</div>
							{showTimezone ? (
								<div className="space-y-1">
									<Label htmlFor="event-timezone" className="text-xs text-neutral-500">
										Times are in
									</Label>
									<TimezoneSelect
										id="event-timezone"
										value={values.timezone}
										onChange={(timezone) => set("timezone", timezone)}
										className="bg-white"
									/>
								</div>
							) : (
								<button
									type="button"
									onClick={() => setShowTimezone(true)}
									className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary"
								>
									<Globe className="size-3.5" />
									{timezoneLabel(values.timezone)}
								</button>
							)}
						</>
					)}
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="event-location">Location</Label>
					<Input
						id="event-location"
						value={values.location}
						maxLength={500}
						placeholder="Room, address, or meeting link"
						onChange={(changeEvent) => set("location", changeEvent.target.value)}
					/>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="event-guests">Guests</Label>
					<GuestInput
						id="event-guests"
						value={values.guests}
						onChange={(guests) => set("guests", guests)}
					/>
					{values.guests.length > 0 && (
						<div className="space-y-1.5 pt-1">
							<Label htmlFor="event-sender" className="text-xs text-neutral-500">
								Send invitations from
							</Label>
							<SenderSelect
								id="event-sender"
								options={senders}
								value={values.senderKey}
								onChange={(key) => set("senderKey", key)}
							/>
							<p className="text-xs text-neutral-500">
								{event
									? "Guests get an updated invitation when you save."
									: "Guests get an email invitation with a calendar file."}
							</p>
						</div>
					)}
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="event-description">Description</Label>
					<Textarea
						id="event-description"
						rows={3}
						maxLength={10_000}
						value={values.description}
						onChange={(changeEvent) => set("description", changeEvent.target.value)}
					/>
				</div>
				<FormError message={validation ?? (save.isError ? errorMessage(save.error) : null)} />
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={onCancel} disabled={save.isPending}>
					Cancel
				</Button>
				<Button type="submit" disabled={save.isPending}>
					{save.isPending ? "Saving..." : event ? "Save changes" : "Create event"}
				</Button>
			</DialogFooter>
		</form>
	);
}
