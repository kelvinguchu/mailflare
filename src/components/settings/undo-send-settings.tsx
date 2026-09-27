"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { UNDO_SEND_DELAY_SECONDS } from "@/lib/email/undo-send";
import {
	getUndoSendDelayPreference,
	setUndoSendDelayPreference,
	type UndoSendDelay,
} from "@/lib/email/undo-send-preference";

export function UndoSendSettings() {
	const [delay, setDelay] = useState<UndoSendDelay | null>(null);
	const [status, setStatus] = useState<string | null>(null);

	// Read after mount: the preference lives in this browser's storage.
	useEffect(() => setDelay(getUndoSendDelayPreference()), []);

	function choose(seconds: UndoSendDelay) {
		setDelay(seconds);
		setStatus(
			setUndoSendDelayPreference(seconds)
				? "Saved"
				: "Couldn’t save in this browser; sends use 10 seconds.",
		);
	}

	return (
		<div className="flex flex-wrap items-center gap-3">
			<div
				role="radiogroup"
				aria-label="Undo send delay"
				className="flex rounded-lg bg-neutral-100 p-0.5"
			>
				{UNDO_SEND_DELAY_SECONDS.map((seconds) => (
					<button
						key={seconds}
						type="button"
						role="radio"
						aria-checked={delay === seconds}
						disabled={delay === null}
						onClick={() => choose(seconds)}
						className={cn(
							"min-w-14 rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
							delay === seconds
								? "bg-white text-neutral-900 shadow-sm"
								: "text-neutral-500 hover:text-neutral-800",
						)}
					>
						{seconds}s
					</button>
				))}
			</div>
			<p role="status" aria-live="polite" className="text-sm text-neutral-500">
				{status}
			</p>
		</div>
	);
}
