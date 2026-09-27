"use client";

import { useEffect, useRef, useState } from "react";
import { Folder } from "lucide-react";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import {
	Combobox,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { authFetch } from "@/lib/auth/client";
import type { CustomFolderSummary } from "./custom-folder-config-types";

type FolderState =
	{ status: "loading" } | { status: "error" } | { status: "ready"; folders: CustomFolderSummary[] };

export type MoveToFolderDialogProps = Readonly<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Resolves once the move finished; the dialog closes on success. */
	onMove: (folder: CustomFolderSummary) => Promise<void> | void;
	count?: number;
	mailboxId?: string | null;
	excludeFolderId?: string;
}>;

export function MoveToFolderDialog({
	open,
	onOpenChange,
	onMove,
	count = 1,
	mailboxId,
	excludeFolderId,
}: MoveToFolderDialogProps) {
	const { selectedMailbox } = useSelectedMailbox();
	const targetMailboxId = mailboxId ?? selectedMailbox?.id ?? null;
	const [state, setState] = useState<FolderState>({ status: "loading" });
	const [selected, setSelected] = useState<CustomFolderSummary | null>(null);
	const [moving, setMoving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setSelected(null);
		setError(null);
		if (!targetMailboxId) {
			setState({ status: "ready", folders: [] });
			return;
		}
		let cancelled = false;
		setState({ status: "loading" });
		const params = new URLSearchParams({ mailboxId: targetMailboxId });
		authFetch(`/api/folders?${params.toString()}`)
			.then(async (response) => {
				if (!response.ok) throw new Error("Unable to load folders");
				return (await response.json()) as { folders?: CustomFolderSummary[] };
			})
			.then((data) => {
				if (cancelled) return;
				const folders = (data.folders ?? [])
					.filter((folder) => folder.id !== excludeFolderId)
					.sort((a, b) => a.name.localeCompare(b.name));
				setState({ status: "ready", folders });
			})
			.catch(() => {
				if (!cancelled) setState({ status: "error" });
			});
		return () => {
			cancelled = true;
		};
	}, [open, targetMailboxId, excludeFolderId]);

	const ready = state.status === "ready";
	useEffect(() => {
		// The search box only mounts once folders arrive, after the dialog took focus.
		if (ready) inputRef.current?.focus();
	}, [ready]);

	async function move(folder: CustomFolderSummary | null) {
		if (!folder || moving) return;
		setMoving(true);
		setError(null);
		try {
			await onMove(folder);
			onOpenChange(false);
		} catch {
			setError("Couldn’t move to that folder. Try again.");
		} finally {
			setMoving(false);
		}
	}

	const folders = state.status === "ready" ? state.folders : [];
	const noun = count === 1 ? "conversation" : `${count} conversations`;

	return (
		<Dialog open={open} onOpenChange={(next) => !moving && onOpenChange(next)}>
			<DialogContent className="sm:max-w-sm" initialFocus={inputRef}>
				<DialogHeader>
					<DialogTitle>Move to folder</DialogTitle>
					<DialogDescription>Choose where to put the {noun}.</DialogDescription>
				</DialogHeader>
				<DialogBody className="pb-1">
					{state.status === "loading" && (
						<p className="py-6 text-center text-sm text-muted-foreground">Loading folders…</p>
					)}
					{state.status === "error" && (
						<p className="py-6 text-center text-sm text-destructive">Folders couldn’t load.</p>
					)}
					{state.status === "ready" && folders.length === 0 && (
						<p className="py-6 text-center text-sm text-muted-foreground">
							No folders yet. Create one from the sidebar.
						</p>
					)}
					{state.status === "ready" && folders.length > 0 && (
						<Combobox
							inline
							open
							items={folders}
							value={selected}
							onValueChange={(value) => setSelected(value)}
							itemToStringLabel={(folder) => folder.name}
							isItemEqualToValue={(a, b) => a.id === b.id}
							autoHighlight
						>
							<ComboboxInput
								aria-label="Search folders"
								placeholder="Search folders"
								showTrigger={false}
								className="w-full"
								disabled={moving}
								ref={inputRef}
							/>
							<ComboboxEmpty className="flex">No matching folders</ComboboxEmpty>
							<ComboboxList className="mt-2 max-h-64 px-0">
								{(folder: CustomFolderSummary) => (
									<ComboboxItem
										key={folder.id}
										value={folder}
										onDoubleClick={() => void move(folder)}
										className="py-2"
									>
										<Folder
											className="size-4"
											style={{ color: folder.color }}
											fill={folder.color}
											fillOpacity={0.2}
										/>
										<span className="truncate">{folder.name}</span>
									</ComboboxItem>
								)}
							</ComboboxList>
						</Combobox>
					)}
					{error && (
						<p role="alert" className="mt-2 text-sm text-destructive">
							{error}
						</p>
					)}
				</DialogBody>
				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={moving}>
						Cancel
					</Button>
					<Button onClick={() => void move(selected)} disabled={!selected || moving}>
						{moving ? "Moving…" : "Move"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
