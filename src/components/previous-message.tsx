"use client";

import { useId, useState } from "react";
import { Ellipsis } from "lucide-react";
import type { PreviousMessageProps } from "./previous-message-types";

const UNKNOWN_TIME = "Unknown time";

/** Quoted history stays out of the way behind a "•••" toggle, as in Gmail. */
export function PreviousMessage({ message }: PreviousMessageProps) {
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const knownDate = message.dateLine && message.dateLine !== UNKNOWN_TIME;

	return (
		<div className="mt-3">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={panelId}
				aria-label={open ? "Hide quoted text" : "Show quoted text"}
				title={open ? "Hide quoted text" : "Show quoted text"}
				onClick={() => setOpen((value) => !value)}
				className="inline-flex h-4 items-center rounded-sm bg-neutral-200/80 px-1 text-neutral-600 outline-none hover:bg-neutral-300 focus-visible:ring-2 focus-visible:ring-primary/40"
			>
				<Ellipsis className="size-4" aria-hidden="true" />
			</button>
			{open && (
				<div id={panelId} className="mt-2 border-l-2 border-neutral-200 pl-3 text-neutral-600">
					{knownDate && (
						<p className="mb-1 text-xs text-neutral-500">
							{message.direction === "sent" ? "You wrote" : "Wrote"} on {message.dateLine}:
						</p>
					)}
					{message.content && (
						<pre className="font-sans text-sm whitespace-pre-wrap">{message.content}</pre>
					)}
					{message.quotedContent.map((nestedMessage, index) => (
						<PreviousMessage
							key={`${nestedMessage.dateLine}-${nestedMessage.content.slice(0, 24)}-${index}`}
							message={nestedMessage}
						/>
					))}
				</div>
			)}
		</div>
	);
}
