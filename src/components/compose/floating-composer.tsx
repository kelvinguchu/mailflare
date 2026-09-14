"use client";

import { ComposeForm } from "@/components/compose/compose-form";
import { useCompose } from "@/components/compose/compose-context";

export function FloatingComposer() {
	const { open, draftId, restoredSnapshot, session, closeComposer } = useCompose();
	if (!open) return null;
	return (
		<ComposeForm
			key={`${session}-${draftId ?? "new"}`}
			mode="popup"
			draftIdToLoad={draftId}
			initialSnapshot={restoredSnapshot}
			onClose={closeComposer}
		/>
	);
}
