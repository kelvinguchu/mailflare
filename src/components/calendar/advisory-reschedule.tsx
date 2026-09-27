"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { calendarKeys, rescheduleCalendarEvent } from "@/lib/calendar/client";
import type { CalendarEventRecord } from "@/lib/calendar/types";
import { instantToWallClock, wallClockToInstant } from "@/lib/calendar/wall-clock";
import { FormError } from "./calendar-fields";
import { errorMessage } from "./calendar-utils";

/** CaliberCode advisory hours are always booked and shown in Nairobi time. */
const NAIROBI = "Africa/Nairobi";
/** Start hours the booking page offers; the CMS checks the full range. */
const START_HOURS = [8, 9, 10, 11, 12, 14, 15, 17, 18, 19, 20];

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Moves a paid CaliberCode advisory session. The length stays what the client paid
 * for; the CMS rejects hours that are taken, closed or in the past, and emails the
 * client an updated calendar invite when the move succeeds.
 */
export function AdvisoryReschedule({
	event,
	onCancel,
	onRescheduled,
}: {
	event: CalendarEventRecord;
	onCancel: () => void;
	onRescheduled: (event: CalendarEventRecord) => void;
}) {
	const queryClient = useQueryClient();
	const current = instantToWallClock(event.startsAt, NAIROBI);
	const hours = Math.max(
		1,
		Math.round((new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()) / 3_600_000),
	);
	const [date, setDate] = useState(current.slice(0, 10));
	const [startHour, setStartHour] = useState(Number(current.slice(11, 13)));
	const endHour = startHour + hours;

	const move = useMutation({
		mutationFn: () =>
			rescheduleCalendarEvent(event.id, {
				startsAt: wallClockToInstant(`${date}T${pad(startHour)}:00`, NAIROBI).toISOString(),
				endsAt: wallClockToInstant(`${date}T${pad(endHour)}:00`, NAIROBI).toISOString(),
			}),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: calendarKeys.all });
			toast.add({
				title: "Session moved",
				description: `Now ${result.when}. The client has been emailed an updated invite.`,
				type: "success",
			});
			onRescheduled(result.event);
		},
	});

	return (
		<form
			className="space-y-4 rounded-lg border border-neutral-200 p-4"
			onSubmit={(submitEvent) => {
				submitEvent.preventDefault();
				move.mutate();
			}}
		>
			<div>
				<p className="text-sm font-medium text-neutral-900">Reschedule this session</p>
				<p className="text-xs text-neutral-500">
					Nairobi time. It stays {hours} hour{hours === 1 ? "" : "s"} long - what the client paid
					for.
				</p>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="reschedule-date">Date</Label>
					<Input
						id="reschedule-date"
						type="date"
						required
						value={date}
						onChange={(changeEvent) => setDate(changeEvent.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="reschedule-start">Starts</Label>
					<Select
						value={String(startHour)}
						onValueChange={(next) => next && setStartHour(Number(next))}
					>
						<SelectTrigger id="reschedule-start" className="w-full">
							<SelectValue>
								{(value: string) => `${pad(Number(value))}:00 – ${pad(Number(value) + hours)}:00`}
							</SelectValue>
						</SelectTrigger>
						<SelectContent alignItemWithTrigger={false}>
							{START_HOURS.map((hour) => (
								<SelectItem key={hour} value={String(hour)}>
									{pad(hour)}:00 – {pad(hour + hours)}:00
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
			<FormError message={move.isError ? errorMessage(move.error) : null} />
			<div className="flex justify-end gap-2">
				<Button type="button" variant="ghost" onClick={onCancel} disabled={move.isPending}>
					Cancel
				</Button>
				<Button type="submit" disabled={move.isPending || !date}>
					{move.isPending ? "Moving..." : "Move session"}
				</Button>
			</div>
		</form>
	);
}
