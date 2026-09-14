"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import type { ComposeSnapshot } from "./types";

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

	return (
		<ComposeContext.Provider
			value={{
				open,
				draftId,
				restoredSnapshot,
				session,
				openComposer: () => {
					setDraftId(null);
					setRestoredSnapshot(null);
					setOpen(true);
				},
				openDraftComposer: (nextDraftId) => {
					setDraftId(nextDraftId);
					setRestoredSnapshot(null);
					setOpen(true);
				},
				restoreComposer: (snapshot) => {
					setDraftId(null);
					setRestoredSnapshot(snapshot);
					setSession((current) => current + 1);
					setOpen(true);
				},
				closeComposer: () => {
					setOpen(false);
					setDraftId(null);
					setRestoredSnapshot(null);
				},
			}}
		>
			{children}
		</ComposeContext.Provider>
	);
}
