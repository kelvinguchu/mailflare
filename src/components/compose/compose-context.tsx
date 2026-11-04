"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ComposeSnapshot } from "./types";
import { listSendRecoveries, removeSendRecovery } from "./send-recovery";
import { lookupSend } from "./send-transport";
import { toast } from "@/components/ui/toast";

type ComposeContextValue = {
	open: boolean;
	draftId: string | null;
	/** A message to reopen after Undo Send or a failed send. */
	restoredSnapshot: ComposeSnapshot | null;
	/** Changes whenever the floating composer should start from fresh state. */
	session: number;
	openComposer: () => void;
	openDraftComposer: (draftId: string) => void;
	restoreComposer: (snapshot: ComposeSnapshot) => void;
	closeComposer: () => void;
};

const ComposeContext = createContext<ComposeContextValue | null>(null);

export function useCompose() {
	const ctx = useContext(ComposeContext);
	if (!ctx) throw new Error("useCompose must be used within ComposeProvider");
	return ctx;
}

export function ComposeProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const [draftId, setDraftId] = useState<string | null>(null);
	const [restoredSnapshot, setRestoredSnapshot] = useState<ComposeSnapshot | null>(null);
	const [session, setSession] = useState(0);
	const returnFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		let canceled = false;
		void listSendRecoveries()
			.then(async (snapshots) => {
				for (const snapshot of snapshots) {
					const outcome = await lookupSend(snapshot.sendKey).catch(() => null);
					if (canceled) return;
					if (outcome?.found && !["failed", "canceled"].includes(outcome.data.status ?? "")) {
						if (outcome.data.status === "sent") await removeSendRecovery(snapshot.sendKey);
						continue;
					}
					const unknown = !outcome || outcome.data.deliveryStatus === "unknown";
					toast.add({
						type: "info",
						title: unknown ? "Send needs a status check" : "Unsent message recovered",
						timeout: 0,
						description: unknown
							? "Open the message in Sent to check its outcome before sending again."
							: "Your message and files are saved on this device.",
						actionProps: unknown
							? undefined
							: {
									children: "Open message",
									onClick: () => {
										setRestoredSnapshot({
											...snapshot,
											sendKey: outcome.found ? crypto.randomUUID() : snapshot.sendKey,
										});
										setSession((current) => current + 1);
										setOpen(true);
									},
								},
					});
				}
			})
			.catch(() => {
				/* A normal session with no recovery does not need a toast. */
			});
		return () => {
			canceled = true;
		};
	}, []);

	useEffect(() => {
		if (open || !returnFocusRef.current) return;
		returnFocusRef.current.focus();
		returnFocusRef.current = null;
	}, [open]);

	function rememberFocus() {
		returnFocusRef.current =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}

	function closeComposer() {
		setOpen(false);
		setDraftId(null);
		setRestoredSnapshot(null);
	}

	return (
		<ComposeContext.Provider
			value={{
				open,
				draftId,
				restoredSnapshot,
				session,
				openComposer: () => {
					rememberFocus();
					setDraftId(null);
					setRestoredSnapshot(null);
					setOpen(true);
				},
				openDraftComposer: (nextDraftId) => {
					rememberFocus();
					setDraftId(nextDraftId);
					setRestoredSnapshot(null);
					setOpen(true);
				},
				restoreComposer: (snapshot) => {
					rememberFocus();
					setDraftId(null);
					setRestoredSnapshot(snapshot);
					setSession((current) => current + 1);
					setOpen(true);
				},
				closeComposer,
			}}
		>
			{children}
		</ComposeContext.Provider>
	);
}
