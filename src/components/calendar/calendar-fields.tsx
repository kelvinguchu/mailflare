"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supportedTimezones, timezoneLabel } from "@/lib/calendar/wall-clock";
import type { SenderOption } from "./calendar-types";

export function TimezoneSelect({
	id,
	value,
	onChange,
	className,
}: {
	id?: string;
	value: string;
	onChange: (timezone: string) => void;
	className?: string;
}) {
	const zones = useMemo(() => supportedTimezones([value]), [value]);
	return (
		<Select value={value} onValueChange={(next) => next && onChange(next)}>
			<SelectTrigger id={id} aria-label="Timezone" className={cn("w-full", className)}>
				<SelectValue>{(zone: string) => timezoneLabel(zone)}</SelectValue>
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={false} className="max-h-72">
				{zones.map((zone) => (
					<SelectItem key={zone} value={zone}>
						{zone.replaceAll("_", " ")}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function SenderSelect({
	id,
	options,
	value,
	onChange,
}: {
	id?: string;
	options: SenderOption[];
	value: string;
	onChange: (key: string) => void;
}) {
	if (options.length === 0) {
		return (
			<p className="rounded-md border border-dashed border-neutral-200 px-3 py-2 text-sm text-neutral-500">
				None of your mailboxes can send mail.
			</p>
		);
	}
	return (
		<Select value={value} onValueChange={(next) => next && onChange(next)}>
			<SelectTrigger id={id} aria-label="Send from" className="w-full">
				<SelectValue>
					{(key: string) =>
						options.find((option) => option.key === key)?.address ?? "Choose sender"
					}
				</SelectValue>
			</SelectTrigger>
			<SelectContent alignItemWithTrigger={false}>
				{options.map((option) => (
					<SelectItem key={option.key} value={option.key}>
						{option.address}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/** Collects guest addresses as removable chips; commits on Enter, comma, space, or blur. */
export function GuestInput({
	id,
	value,
	onChange,
}: {
	id?: string;
	value: string[];
	onChange: (guests: string[]) => void;
}) {
	const [draft, setDraft] = useState("");
	const [invalid, setInvalid] = useState<string | null>(null);

	function commit(text: string) {
		const entries = text
			.split(/[\s,;]+/)
			.map((entry) => entry.trim().toLowerCase())
			.filter(Boolean);
		if (entries.length === 0) return true;
		const bad = entries.find((entry) => !EMAIL_PATTERN.test(entry));
		if (bad) {
			setInvalid(bad);
			return false;
		}
		setInvalid(null);
		onChange([...new Set([...value, ...entries])]);
		setDraft("");
		return true;
	}

	return (
		<div>
			<div
				className={cn(
					"flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input px-1.5 py-1 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
					invalid && "border-destructive ring-destructive/20",
				)}
			>
				{value.map((guest) => (
					<span
						key={guest}
						className="inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-100 py-0.5 pr-1 pl-2 text-xs text-neutral-800"
					>
						<span className="truncate">{guest}</span>
						<button
							type="button"
							onClick={() => onChange(value.filter((item) => item !== guest))}
							className="rounded-full p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800"
							aria-label={`Remove ${guest}`}
						>
							<X className="size-3" />
						</button>
					</span>
				))}
				<input
					id={id}
					value={draft}
					onChange={(event) => {
						setDraft(event.target.value);
						setInvalid(null);
					}}
					onKeyDown={(event) => {
						if (["Enter", ",", " ", ";"].includes(event.key)) {
							event.preventDefault();
							commit(draft);
						} else if (event.key === "Backspace" && !draft && value.length) {
							onChange(value.slice(0, -1));
						}
					}}
					onBlur={() => commit(draft)}
					onPaste={(event) => {
						const text = event.clipboardData.getData("text");
						if (/[\s,;]/.test(text)) {
							event.preventDefault();
							commit(`${draft} ${text}`);
						}
					}}
					placeholder={value.length ? "" : "name@example.com"}
					className="min-w-40 flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted-foreground"
				/>
			</div>
			{invalid && (
				<p className="mt-1 text-xs text-destructive">“{invalid}” is not a valid email address.</p>
			)}
		</div>
	);
}

export function FormError({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p
			role="alert"
			className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"
		>
			{message}
		</p>
	);
}
