"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { authFetch } from "@/lib/auth/client";
import { calendarKeys } from "@/lib/calendar/client";
import type { IcsMeeting } from "@/lib/calendar/ical";
import type { CalendarImportOptions } from "@/lib/calendar/import";

type PreviewMeeting = IcsMeeting & {
	existingSequence: number | null;
	existingTitle: string | null;
};
const NO_ATTENDEES: string[] = [];
export type InvitationSource = { file: File } | { messageId: string; attachmentId: string };

async function invitationRequest(
	source: InvitationSource,
	options: CalendarImportOptions,
	preview: boolean,
) {
	let body: FormData | string;
	const headers: Record<string, string> = {};
	if ("file" in source) {
		body = new FormData();
		body.set("file", source.file);
		body.set("options", JSON.stringify(options));
	} else {
		body = JSON.stringify({ ...source, ...options });
		headers["Content-Type"] = "application/json";
	}
	const response = await authFetch(`/api/calendar/import${preview ? "/preview" : ""}`, {
		method: "POST",
		body,
		headers,
		signal: AbortSignal.timeout(15_000),
	});
	const data = (await response.json()) as {
		meetings?: PreviewMeeting[];
		outcome?: string;
		error?: string;
	};
	if (!response.ok) throw new Error(data.error ?? "Could not import this invitation");
	return data;
}

export function InvitationDialog({
	source,
	onClose,
	proposedAttendees = NO_ATTENDEES,
}: {
	source: InvitationSource;
	onClose: () => void;
	proposedAttendees?: string[];
}) {
	const queryClient = useQueryClient();
	const [meetings, setMeetings] = useState<PreviewMeeting[] | null>(null);
	const [index, setIndex] = useState(0);
	const [timezone, setTimezone] = useState("");
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [location, setLocation] = useState("");
	const [attendees, setAttendees] = useState("");
	const [addReminder, setAddReminder] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		let canceled = false;
		void invitationRequest(source, {}, true)
			.then((data) => {
				if (!canceled) setMeetings(data.meetings ?? []);
			})
			.catch((reason: unknown) => {
				if (!canceled)
					setError(reason instanceof Error ? reason.message : "Could not read invitation");
			});
		return () => {
			canceled = true;
		};
	}, [source]);
	const meeting = meetings?.[index];
	useEffect(() => {
		if (!meeting) return;
		setTitle(meeting.title);
		setDescription(meeting.description);
		setLocation(meeting.location);
		setAttendees([...new Set([...meeting.attendees, ...proposedAttendees])].join(", "));
		setTimezone("");
		setAddReminder(false);
	}, [meeting, proposedAttendees]);
	async function confirm() {
		if (!meeting) return;
		setSaving(true);
		setError("");
		try {
			const result = await invitationRequest(
				source,
				{
					index: meeting.index,
					timezone: timezone || undefined,
					confirmed: true,
					expectedSequence: meeting.existingSequence,
					title,
					description,
					location,
					attendees: attendees
						.split(",")
						.map((value) => value.trim())
						.filter(Boolean),
					addReminder,
				},
				false,
			);
			await queryClient.invalidateQueries({ queryKey: calendarKeys.all });
			toast.add({
				type: "success",
				title:
					result.outcome === "cancelled"
						? "Meeting cancelled"
						: result.outcome === "updated"
							? "Meeting updated"
							: result.outcome === "unchanged"
								? "Already in calendar"
								: "Added to calendar",
			});
			onClose();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "Could not import invitation");
		} finally {
			setSaving(false);
		}
	}
	return (
		<Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
			<DialogContent className="sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{meeting?.cancelled ? "Cancel meeting" : "Add to calendar"}</DialogTitle>
					<DialogDescription>
						Review this invitation. No RSVP or invitations will be sent.
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="space-y-4">
					{!meetings && !error && <p className="text-sm text-neutral-500">Reading invitation…</p>}
					{meetings && meetings.length > 1 && (
						<div className="space-y-1">
							<Label htmlFor="invite-event">Meeting</Label>
							<select
								id="invite-event"
								className="w-full rounded-md border p-2 text-sm"
								value={index}
								onChange={(event) => setIndex(Number(event.target.value))}
							>
								{meetings.map((item, itemIndex) => (
									<option value={itemIndex} key={item.index}>
										{item.title}
									</option>
								))}
							</select>
						</div>
					)}
					{meeting && (
						<>
							{meeting.warning && (
								<p role="alert" className="text-sm text-amber-700">
									{meeting.warning}
								</p>
							)}
							<p className="text-sm text-neutral-600">
								{meeting.startsAt ?? "Cancellation notice"}
								{meeting.endsAt ? ` – ${meeting.endsAt}` : ""}
								{meeting.allDay
									? " · All day (end date exclusive)"
									: ` · ${meeting.timezone ?? "Timezone required"}`}
							</p>
							{meeting.organizer && (
								<p className="text-xs text-neutral-500">Organizer: {meeting.organizer}</p>
							)}
							{meeting.existingSequence !== null && (
								<p className="text-sm text-neutral-600">
									{meeting.sequence <= meeting.existingSequence
										? "This version is already in your calendar."
										: `Confirm replacement of “${meeting.existingTitle}” with this organizer’s update.`}
								</p>
							)}
							{meeting.requiresTimezone && (
								<div className="space-y-1">
									<Label htmlFor="invite-timezone">Invitation timezone</Label>
									<Input
										id="invite-timezone"
										value={timezone}
										placeholder="Africa/Nairobi"
										onChange={(event) => setTimezone(event.target.value)}
									/>
									<p className="text-xs text-neutral-500">
										The invitation uses floating time. Choose an IANA timezone.
									</p>
								</div>
							)}
							{!meeting.cancelled && (
								<>
									<div className="space-y-1">
										<Label htmlFor="invite-title">Title</Label>
										<Input
											id="invite-title"
											value={title}
											onChange={(event) => setTitle(event.target.value)}
											maxLength={200}
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="invite-location">Location</Label>
										<Input
											id="invite-location"
											value={location}
											onChange={(event) => setLocation(event.target.value)}
											maxLength={500}
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="invite-attendees">Attendees</Label>
										<Input
											id="invite-attendees"
											value={attendees}
											onChange={(event) => setAttendees(event.target.value)}
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="invite-description">Note</Label>
										<Textarea
											id="invite-description"
											value={description}
											onChange={(event) => setDescription(event.target.value)}
											maxLength={10000}
										/>
									</div>
									{meeting.alarmMinutes !== null && (
										<label className="flex items-center gap-2 text-sm">
											<input
												type="checkbox"
												aria-label={`Remind me ${meeting.alarmMinutes} minutes before`}
												checked={addReminder}
												onChange={(event) => setAddReminder(event.target.checked)}
											/>
											Remind me {meeting.alarmMinutes} minutes before
										</label>
									)}
								</>
							)}
						</>
					)}
					{error && (
						<p role="alert" className="text-sm text-red-600">
							{error}
						</p>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose} disabled={saving}>
						Cancel
					</Button>
					<Button
						onClick={() => void confirm()}
						disabled={
							saving ||
							!meeting ||
							Boolean(meeting.warning) ||
							(meeting.requiresTimezone && !timezone.trim())
						}
					>
						{saving
							? "Saving…"
							: meeting?.cancelled
								? "Confirm cancellation"
								: meeting?.existingSequence !== null
									? "Confirm import"
									: "Add to calendar"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
