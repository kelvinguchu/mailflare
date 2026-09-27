"use client";

import { useMemo, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
	formatRecipientList,
	parseRecipientList,
	RecipientValidationError,
	type NormalizedRecipient,
} from "@/lib/email/recipients";

export function RecipientField({
	id,
	label,
	value,
	onChange,
	inputRef,
	disabled,
	required = false,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	inputRef?: RefObject<HTMLInputElement | null>;
	disabled?: boolean;
	required?: boolean;
}) {
	const [draft, setDraft] = useState("");
	const [error, setError] = useState<string | null>(null);
	const recipients = useMemo(() => safeParse(value), [value]);
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;

	function commit(nextDraft = draft) {
		const trimmed = nextDraft
			.trim()
			.replace(/[,;]+$/, "")
			.trim();
		if (!trimmed) return true;
		try {
			const parsed = parseRecipientList(trimmed);
			const seen = new Set(recipients.map((recipient) => recipient.address));
			const next = [...recipients, ...parsed.filter((recipient) => !seen.has(recipient.address))];
			onChange(formatRecipientList(next));
			setDraft("");
			setError(null);
			return true;
		} catch (reason) {
			setError(
				reason instanceof RecipientValidationError ? reason.message : "Add a valid email address",
			);
			return false;
		}
	}

	function remove(recipient: NormalizedRecipient) {
		onChange(formatRecipientList(recipients.filter((item) => item.address !== recipient.address)));
		setError(null);
	}

	return (
		<div className="flex min-h-10 items-start gap-2 py-1">
			<Label htmlFor={id} className="w-7 shrink-0 pt-1.5 text-xs font-medium text-neutral-500">
				{label}
			</Label>
			<div className="min-w-0 flex-1">
				<div className="flex min-h-8 flex-wrap items-center gap-1.5">
					{recipients.map((recipient) => (
						<span
							key={recipient.address}
							className="inline-flex max-w-full items-center gap-1 rounded-full bg-neutral-100 py-1 pr-1 pl-2.5 text-sm text-neutral-800"
						>
							<span className="truncate">{recipient.name || recipient.address}</span>
							<button
								type="button"
								disabled={disabled}
								onClick={() => remove(recipient)}
								aria-label={`Remove ${recipient.formatted} from ${label}`}
								className="rounded-full p-0.5 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-primary/40"
							>
								<X aria-hidden="true" className="size-3" />
							</button>
						</span>
					))}
					<input
						ref={inputRef}
						id={id}
						aria-label={`${label} recipients`}
						name={label.toLowerCase()}
						type="text"
						autoComplete="off"
						inputMode="email"
						spellCheck={false}
						disabled={disabled}
						aria-required={required}
						aria-invalid={error ? true : undefined}
						aria-describedby={`${hintId}${error ? ` ${errorId}` : ""}`}
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							setError(null);
						}}
						onBlur={() => commit()}
						onPaste={(event) => {
							const pasted = event.clipboardData.getData("text");
							if (!/[,;\n]/.test(pasted)) return;
							event.preventDefault();
							commit(`${draft}${draft ? ", " : ""}${pasted.replace(/\n/g, ",")}`);
						}}
						onKeyDown={(event) => {
							if (["Enter", "Tab", ",", ";"].includes(event.key) && draft.trim()) {
								if (event.key !== "Tab") event.preventDefault();
								commit();
							} else if (event.key === "Backspace" && !draft && recipients.length > 0) {
								remove(recipients[recipients.length - 1]);
							}
						}}
						placeholder={recipients.length === 0 ? "name@example.com" : "Add another"}
						className="min-w-36 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-neutral-400"
					/>
				</div>
				<span id={hintId} className="sr-only">
					Type an address and press Enter, comma, semicolon, or Tab. Backspace removes the last
					recipient.
				</span>
				{error && (
					<p id={errorId} role="alert" className="pb-1 text-xs text-red-600">
						{error}
					</p>
				)}
			</div>
		</div>
	);
}

function safeParse(value: string): NormalizedRecipient[] {
	try {
		return parseRecipientList(value);
	} catch {
		return [];
	}
}
