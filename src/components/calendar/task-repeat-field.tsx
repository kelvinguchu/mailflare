"use client";

import { Repeat } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	MAX_RECURRENCE_COUNT,
	MAX_RECURRENCE_INTERVAL,
	describeRecurrenceRule,
	type TaskRecurrenceFrequency,
} from "@/lib/calendar/recurrence";
import { cn } from "@/lib/utils";
import {
	REPEAT_FREQUENCY_OPTIONS,
	WEEKDAY_OPTIONS,
	buildTaskRecurrenceRule,
	customRepeatFrom,
	getRepeatPresetOptions,
	repeatDueKey,
	type TaskRepeatDue,
	type TaskRepeatEnd,
	type TaskRepeatPreset,
	type TaskRepeatValues,
} from "./task-repeat-utils";

const END_OPTIONS: Array<{ value: TaskRepeatEnd; label: string }> = [
	{ value: "never", label: "Never" },
	{ value: "until", label: "On date" },
	{ value: "count", label: "After" },
];

const SEGMENT_CLASS =
	"rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50";

export function TaskRepeatField({
	values,
	due,
	disabled,
	onChange,
}: Readonly<{
	values: TaskRepeatValues;
	due: TaskRepeatDue;
	disabled: boolean;
	onChange: (values: TaskRepeatValues) => void;
}>) {
	const noDue = due.dueMode === "none";
	const presets = getRepeatPresetOptions(due);
	const active = !noDue && values.preset !== "none";
	const summary = active ? repeatSummary(values, due) : null;
	const set = (changes: Partial<TaskRepeatValues>) => onChange({ ...values, ...changes });

	function choosePreset(preset: TaskRepeatPreset) {
		if (preset === "custom") onChange(customRepeatFrom(values, due));
		else set({ preset });
	}

	return (
		<div className="space-y-2">
			<Select
				value={noDue ? "none" : values.preset}
				disabled={disabled || noDue}
				onValueChange={(value) => value && choosePreset(value as TaskRepeatPreset)}
			>
				<SelectTrigger id="task-repeat" className="w-full sm:w-72">
					<SelectValue>
						{(value: TaskRepeatPreset) => (
							<>
								<Repeat
									className={cn("size-4", value === "none" ? "text-neutral-400" : "text-primary")}
								/>
								{presets.find((option) => option.value === value)?.label}
							</>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent alignItemWithTrigger={false}>
					{presets.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{noDue && <p className="text-xs text-neutral-500">Set a due date to repeat this task.</p>}

			{active && values.preset === "custom" && (
				<CustomRepeat values={values} disabled={disabled} onChange={set} />
			)}

			{active && (
				<div className="flex flex-wrap items-center gap-2">
					<span className="text-xs text-neutral-500">Ends</span>
					<div
						className="inline-grid grid-cols-3 gap-0.5 rounded-lg bg-neutral-100 p-0.5"
						role="radiogroup"
						aria-label="Repeat ends"
					>
						{END_OPTIONS.map((option) => (
							<button
								key={option.value}
								type="button"
								role="radio"
								aria-checked={values.end === option.value}
								disabled={disabled}
								onClick={() =>
									set({
										end: option.value,
										until:
											option.value === "until" && !values.until
												? defaultUntil(repeatDueKey(due))
												: values.until,
									})
								}
								className={cn(
									SEGMENT_CLASS,
									values.end === option.value
										? "bg-white text-neutral-900 shadow-sm"
										: "text-neutral-500 hover:text-neutral-800",
								)}
							>
								{option.label}
							</button>
						))}
					</div>
					{values.end === "until" && (
						<Input
							type="date"
							required
							aria-label="Repeat end date"
							value={values.until}
							min={repeatDueKey(due) ?? undefined}
							disabled={disabled}
							onChange={(event) => set({ until: event.target.value })}
							className="w-full sm:w-44"
						/>
					)}
					{values.end === "count" && (
						<span className="flex items-center gap-2 text-sm text-neutral-700">
							<Input
								type="number"
								required
								aria-label="Number of times"
								min={1}
								max={MAX_RECURRENCE_COUNT}
								value={Number.isFinite(values.count) ? values.count : ""}
								disabled={disabled}
								onChange={(event) => set({ count: event.target.valueAsNumber })}
								className="w-20"
							/>
							times
						</span>
					)}
				</div>
			)}

			{summary && (
				<p className="text-xs text-neutral-500">
					{summary}. Completing it creates the next one with the same reminders.
				</p>
			)}
		</div>
	);
}

function CustomRepeat({
	values,
	disabled,
	onChange,
}: Readonly<{
	values: TaskRepeatValues;
	disabled: boolean;
	onChange: (changes: Partial<TaskRepeatValues>) => void;
}>) {
	function toggleWeekday(weekday: number) {
		const selected = values.weekdays.includes(weekday);
		// A weekly rule always keeps at least one day.
		if (selected && values.weekdays.length === 1) return;
		onChange({
			weekdays: selected
				? values.weekdays.filter((day) => day !== weekday)
				: [...values.weekdays, weekday],
		});
	}

	return (
		<div className="space-y-2 rounded-lg border border-neutral-200 p-3">
			<div className="flex flex-wrap items-center gap-2 text-sm text-neutral-700">
				<span>Every</span>
				<Input
					type="number"
					aria-label="Repeat interval"
					min={1}
					max={MAX_RECURRENCE_INTERVAL}
					value={Number.isFinite(values.interval) ? values.interval : ""}
					disabled={disabled}
					onChange={(event) => onChange({ interval: event.target.valueAsNumber })}
					className="w-20"
				/>
				<Select
					value={values.frequency}
					disabled={disabled}
					onValueChange={(value) =>
						value &&
						onChange({
							frequency: value as TaskRecurrenceFrequency,
							monthDay: null,
							month: null,
						})
					}
				>
					<SelectTrigger aria-label="Repeat unit" className="w-32">
						<SelectValue>
							{(value: TaskRecurrenceFrequency) =>
								REPEAT_FREQUENCY_OPTIONS.find((option) => option.value === value)?.label
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent alignItemWithTrigger={false}>
						{REPEAT_FREQUENCY_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{values.frequency === "weekly" && (
				<div className="flex flex-wrap gap-1" role="group" aria-label="Repeat on">
					{WEEKDAY_OPTIONS.map((option) => {
						const selected = values.weekdays.includes(option.value);
						return (
							<button
								key={option.value}
								type="button"
								aria-pressed={selected}
								aria-label={option.label}
								title={option.label}
								disabled={disabled}
								onClick={() => toggleWeekday(option.value)}
								className={cn(
									"size-8 rounded-full text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
									selected
										? "bg-primary text-primary-foreground"
										: "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
								)}
							>
								{option.short}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

function repeatSummary(values: TaskRepeatValues, due: TaskRepeatDue): string | null {
	try {
		return describeRecurrenceRule(buildTaskRecurrenceRule(values, due));
	} catch {
		return null;
	}
}

/** Three months after the due date, a reasonable first guess for an end date. */
function defaultUntil(dueKey: string | null): string {
	if (!dueKey) return "";
	const [year, month, day] = dueKey.split("-").map(Number);
	const date = new Date(Date.UTC(year!, month! + 2, day!));
	return date.toISOString().slice(0, 10);
}
