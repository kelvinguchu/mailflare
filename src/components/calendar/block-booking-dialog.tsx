"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { blockBookingTime, calendarKeys } from "@/lib/calendar/client";
import { dateKey } from "@/lib/calendar/wall-clock";
import { FormError } from "./calendar-fields";
import { errorMessage } from "./calendar-utils";

/** The hours an advisory session can run, Nairobi time: 08:00 to 16:00. */
const FIRST_HOUR = 8;
const LAST_HOUR = 16;
const pad = (value: number) => String(value).padStart(2, "0");
const hourOptions = (from: number, to: number) =>
	Array.from({ length: to - from + 1 }, (_, index) => from + index);

type Conflict = { reference: string; name: string; startHour: number; endHour: number };

/**
 * Blocks a whole day, or chosen hours, from CaliberCode advisory bookings. The
 * booking page stops offering that time; paid sessions already in it are kept and
 * listed here so they can be rescheduled from their own calendar entries.
 */
export function BlockBookingDialog({
	open,
	initialDate,
	onClose,
}: {
	open: boolean;
	initialDate: Date;
	onClose: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			{open && (
				<DialogContent className="sm:max-w-md">
					<BlockBookingForm initialDate={initialDate} onClose={onClose} />
				</DialogContent>
			)}
		</Dialog>
	);
}

function BlockBookingForm({ initialDate, onClose }: { initialDate: Date; onClose: () => void }) {
	const queryClient = useQueryClient();
	const [date, setDate] = useState(() => {
		const today = dateKey(new Date());
		const chosen = dateKey(initialDate);
		return chosen < today ? today : chosen;
	});
	const [wholeDay, setWholeDay] = useState(true);
	const [startHour, setStartHour] = useState(10);
	const [endHour, setEndHour] = useState(13);
	const [conflicts, setConflicts] = useState<Conflict[] | null>(null);

	const block = useMutation({
		mutationFn: () =>
			blockBookingTime(
				wholeDay ? { date, startHour: 0, endHour: 24 } : { date, startHour, endHour },
			),
		onSuccess: async (result) => {
			await queryClient.invalidateQueries({ queryKey: calendarKeys.all });
			toast.add({
				title: "Booking time blocked",
				description: "The booking page no longer offers that time.",
				type: "success",
			});
			if (result.conflicts.length) setConflicts(result.conflicts);
			else onClose();
		},
	});

	if (conflicts) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>Blocked - paid sessions still booked</DialogTitle>
					<DialogDescription>
						Nobody new can book this time, but these paid sessions are still on. Open each one in
						the calendar to reschedule it.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<ul className="space-y-2 text-sm">
						{conflicts.map((conflict) => (
							<li
								key={conflict.reference}
								className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900"
							>
								<TriangleAlert className="mt-0.5 size-4 flex-none" aria-hidden="true" />
								<span>
									{pad(conflict.startHour)}:00 – {pad(conflict.endHour)}:00 · {conflict.name}
								</span>
							</li>
						))}
					</ul>
				</DialogBody>
				<DialogFooter>
					<Button type="button" onClick={onClose}>
						Done
					</Button>
				</DialogFooter>
			</>
		);
	}

	return (
		<form
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				block.mutate();
			}}
		>
			<DialogHeader>
				<DialogTitle>Block booking time</DialogTitle>
				<DialogDescription>
					Stops clients booking CaliberCode advisory sessions on the booking page. Nairobi time.
				</DialogDescription>
			</DialogHeader>
			<DialogBody className="space-y-4">
				<div className="space-y-1.5">
					<Label htmlFor="block-date">Date</Label>
					<Input
						id="block-date"
						type="date"
						required
						min={dateKey(new Date())}
						value={date}
						onChange={(changeEvent) => setDate(changeEvent.target.value)}
					/>
				</div>
				<div className="flex items-center justify-between gap-3">
					<Label htmlFor="block-whole-day">Whole day</Label>
					<Switch id="block-whole-day" checked={wholeDay} onCheckedChange={setWholeDay} />
				</div>
				{!wholeDay && (
					<div className="grid gap-3 sm:grid-cols-2">
						<HourSelect
							id="block-from"
							label="From"
							value={startHour}
							hours={hourOptions(FIRST_HOUR, LAST_HOUR - 1)}
							onChange={(hour) => {
								setStartHour(hour);
								if (endHour <= hour) setEndHour(hour + 1);
							}}
						/>
						<HourSelect
							id="block-to"
							label="Until"
							value={endHour}
							hours={hourOptions(startHour + 1, LAST_HOUR)}
							onChange={setEndHour}
						/>
					</div>
				)}
				<FormError message={block.isError ? errorMessage(block.error) : null} />
			</DialogBody>
			<DialogFooter>
				<Button type="button" variant="ghost" onClick={onClose} disabled={block.isPending}>
					Cancel
				</Button>
				<Button type="submit" disabled={block.isPending || !date}>
					{block.isPending ? "Blocking..." : "Block time"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function HourSelect({
	id,
	label,
	value,
	hours,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	hours: number[];
	onChange: (hour: number) => void;
}) {
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select value={String(value)} onValueChange={(next) => next && onChange(Number(next))}>
				<SelectTrigger id={id} className="w-full">
					<SelectValue>{(selected: string) => `${pad(Number(selected))}:00`}</SelectValue>
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={false}>
					{hours.map((hour) => (
						<SelectItem key={hour} value={String(hour)}>
							{pad(hour)}:00
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
