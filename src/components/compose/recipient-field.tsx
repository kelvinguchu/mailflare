"use client";

import { useEffect, useId, useMemo, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
	formatRecipientList,
	parseRecipientList,
	RecipientValidationError,
	type NormalizedRecipient,
} from "@/lib/email/recipients";

type Suggestion = { email: string; displayName: string | null };

/** How long typing must pause before suggestions are fetched. */
const SUGGEST_DELAY_MS = 200;

/** A suggestion as a recipient string, quoting the name so commas cannot split it. */
function suggestionAddress(suggestion: Suggestion): string {
	const name = suggestion.displayName?.trim();
	if (!name) return suggestion.email;
	return `"${name.replace(/["\\]/g, "\\$&")}" <${suggestion.email}>`;
}

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
	const [focused, setFocused] = useState(false);
	const [open, setOpen] = useState(false);
	const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
	const [active, setActive] = useState(-1);
	const request = useRef<AbortController | null>(null);
	const recipients = useMemo(() => safeParse(value), [value]);
	const hintId = `${id}-hint`;
	const errorId = `${id}-error`;
	const listId = `${useId()}-suggestions`;

	// Anyone already on this line is not suggested again.
	const options = useMemo(() => {
		const chosen = new Set(recipients.map((recipient) => recipient.address.toLowerCase()));
		return suggestions.filter((suggestion) => !chosen.has(suggestion.email.toLowerCase()));
	}, [recipients, suggestions]);
	const showList = open && focused && !disabled && options.length > 0;

	// Recent contacts on focus, matches while typing. Each new request cancels
	// the one before it, so a slow reply can never overwrite a newer one.
	useEffect(() => {
		if (!focused || disabled) return;
		const query = draft.trim();
		if (/[,;]/.test(query) || query.length > 100) {
			setSuggestions([]);
			return;
		}
		const timer = setTimeout(
			() => {
				request.current?.abort();
				const controller = new AbortController();
				request.current = controller;
				fetch(`/api/contacts/suggestions?q=${encodeURIComponent(query)}`, {
					credentials: "same-origin",
					signal: controller.signal,
				})
					.then(
						(response): Promise<{ suggestions?: Suggestion[] }> | { suggestions: Suggestion[] } =>
							response.ok
								? (response.json() as Promise<{ suggestions?: Suggestion[] }>)
								: { suggestions: [] },
					)
					.then((data: { suggestions?: Suggestion[] }) => {
						if (controller.signal.aborted) return;
						setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
						setActive(-1);
					})
					.catch(() => {
						// Aborted, offline or unavailable: typing an address still works.
					});
			},
			query ? SUGGEST_DELAY_MS : 0,
		);
		return () => clearTimeout(timer);
	}, [draft, focused, disabled]);

	useEffect(() => () => request.current?.abort(), []);

	function closeList() {
		setOpen(false);
		setActive(-1);
	}

	function choose(suggestion: Suggestion) {
		if (commit(suggestionAddress(suggestion))) {
			closeList();
			setSuggestions([]);
		}
	}

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
			<div className="relative min-w-0 flex-1">
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
						role="combobox"
						aria-autocomplete="list"
						aria-expanded={showList}
						aria-controls={listId}
						aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
						value={draft}
						onChange={(event) => {
							setDraft(event.target.value);
							setError(null);
							setOpen(true);
						}}
						onFocus={() => {
							setFocused(true);
							setOpen(true);
						}}
						onBlur={() => {
							setFocused(false);
							closeList();
							commit();
						}}
						onPaste={(event) => {
							const pasted = event.clipboardData.getData("text");
							if (!/[,;\n]/.test(pasted)) return;
							event.preventDefault();
							commit(`${draft}${draft ? ", " : ""}${pasted.replace(/\n/g, ",")}`);
						}}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown" || event.key === "ArrowUp") {
								if (options.length === 0) return;
								event.preventDefault();
								const step = event.key === "ArrowDown" ? 1 : -1;
								setOpen(true);
								setActive((current) =>
									!showList || current < 0
										? step > 0
											? 0
											: options.length - 1
										: (current + step + options.length) % options.length,
								);
								return;
							}
							if (event.key === "Escape" && showList) {
								// Only swallow Escape while the list is open, so it still closes dialogs.
								event.preventDefault();
								event.stopPropagation();
								closeList();
								return;
							}
							if (event.key === "Enter" && showList && active >= 0 && options[active]) {
								event.preventDefault();
								choose(options[active]);
								return;
							}
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
				{showList && (
					<ul
						id={listId}
						role="listbox"
						aria-label={`${label} suggestions`}
						className="absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg"
					>
						{options.map((suggestion, index) => (
							// Keyboard use goes through the input (arrows, Enter, Escape) - the combobox pattern.
							// eslint-disable-next-line jsx-a11y/click-events-have-key-events
							<li
								key={suggestion.email}
								id={`${listId}-${index}`}
								role="option"
								aria-selected={index === active}
								// Keep focus in the input so blur does not commit the half-typed text.
								onMouseDown={(event) => event.preventDefault()}
								onMouseEnter={() => setActive(index)}
								onClick={() => choose(suggestion)}
								className={`flex cursor-pointer flex-col px-3 py-1.5 text-sm ${
									index === active ? "bg-neutral-100" : "hover:bg-neutral-50"
								}`}
							>
								<span className="truncate text-neutral-900">
									{suggestion.displayName?.trim() || suggestion.email}
								</span>
								{suggestion.displayName?.trim() ? (
									<span className="truncate text-xs text-neutral-500">{suggestion.email}</span>
								) : null}
							</li>
						))}
					</ul>
				)}
				<span id={hintId} className="sr-only">
					Type an address and press Enter, comma, semicolon, or Tab. Backspace removes the last
					recipient. Use the up and down arrows to choose a suggestion.
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
