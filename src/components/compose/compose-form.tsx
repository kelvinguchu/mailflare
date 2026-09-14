"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Minimize2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { authFetch } from "@/lib/auth/client";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { useCompose } from "./compose-context";
import { sendWithUndo } from "./send-with-undo";
import { applyMailboxSignature, fetchDraft, formatAttachmentSize } from "./utils";
import type { ComposeAttachment, ComposeSnapshot } from "./types";

function showComposeError(message: string) {
	toast.add({ type: "error", title: message });
}

export function ComposeForm({
	mode = "page",
	draftIdToLoad,
	initialSnapshot,
	onClose,
}: {
	mode?: "page" | "popup";
	draftIdToLoad?: string | null;
	/** A message restored after Undo Send or a failed send. */
	initialSnapshot?: ComposeSnapshot | null;
	onClose?: () => void;
}) {
	const { selectedMailbox, setSelectedMailbox, mailboxes } = useSelectedMailbox();
	const { restoreComposer } = useCompose();
	const [draftId, setDraftId] = useState<string | null>(initialSnapshot?.draftId ?? null);
	const [replyToMessageId, setReplyToMessageId] = useState<string | null>(
		initialSnapshot?.replyToMessageId ?? null,
	);
	const [to, setTo] = useState(initialSnapshot?.to ?? "");
	const [subject, setSubject] = useState(initialSnapshot?.subject ?? "");
	const [text, setText] = useState(initialSnapshot?.text ?? "");
	const [attachments, setAttachments] = useState<ComposeAttachment[]>(
		initialSnapshot?.attachments ?? [],
	);
	const [loadingDraft, setLoadingDraft] = useState(false);
	// A restored message reuses the draft-loading path to reselect its mailbox and sender.
	const [loadedDraftMailboxId, setLoadedDraftMailboxId] = useState<string | null>(
		initialSnapshot?.mailboxId ?? null,
	);
	const [loadedDraftFrom, setLoadedDraftFrom] = useState<string | null>(
		initialSnapshot?.selectedFrom ?? null,
	);
	const [selectedFrom, setSelectedFrom] = useState("");
	const [undoDelaySeconds, setUndoDelaySeconds] = useState(
		initialSnapshot?.undoDelaySeconds ?? "10",
	);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const draftSave = useRef<Promise<string | null> | null>(null);
	const attachmentInput = useRef<HTMLInputElement | null>(null);
	const previousSignature = useRef("");
	// Resending an unchanged message reuses its Idempotency-Key; any edit starts a new send.
	const pendingSend = useRef<{ fingerprint: string; key: string } | null>(
		initialSnapshot
			? { fingerprint: snapshotFingerprint(initialSnapshot), key: initialSnapshot.sendKey }
			: null,
	);

	useEffect(() => {
		if (!selectedMailbox && mailboxes.length === 1) setSelectedMailbox(mailboxes[0]);
	}, [mailboxes, selectedMailbox, setSelectedMailbox]);

	const senderAddresses = useMemo(() => {
		if (!selectedMailbox) return [];
		return selectedMailbox.senderAddresses?.length
			? selectedMailbox.senderAddresses
			: [`${selectedMailbox.localPart}@${selectedMailbox.hostname}`];
	}, [selectedMailbox]);
	const senderOptions = useMemo(
		() =>
			mailboxes.flatMap((mailbox) => {
				const addresses = mailbox.senderAddresses?.length
					? mailbox.senderAddresses
					: [`${mailbox.localPart}@${mailbox.hostname}`];
				return addresses.map((address) => ({ mailbox, address }));
			}),
		[mailboxes],
	);
	const fromAddr =
		selectedMailbox && selectedFrom
			? formatEmailAddress(selectedFrom, selectedMailbox.displayName)
			: "";

	useEffect(() => {
		if (!senderAddresses.length) {
			setSelectedFrom("");
			return;
		}
		if (!senderAddresses.includes(selectedFrom)) setSelectedFrom(senderAddresses[0]);
	}, [selectedFrom, senderAddresses]);

	useEffect(() => {
		if (!draftIdToLoad) return;

		let cancelled = false;
		setLoadingDraft(true);
		fetchDraft(draftIdToLoad)
			.then((draft) => {
				if (cancelled) return;

				setDraftId(draft.id);
				setReplyToMessageId(draft.replyToMessageId ?? null);
				setTo(draft.toAddr);
				setSubject(draft.subject ?? "");
				setText(draft.textBody ?? "");
				setLoadedDraftMailboxId(draft.mailboxId);
				setLoadedDraftFrom(getEmailAddress(draft.fromAddr).toLowerCase());
			})
			.catch((err) => {
				if (cancelled) return;
				showComposeError(err instanceof Error ? err.message : "Failed to load draft");
			})
			.finally(() => {
				if (!cancelled) setLoadingDraft(false);
			});

		return () => {
			cancelled = true;
		};
	}, [draftIdToLoad]);

	useEffect(() => {
		if (!loadedDraftMailboxId) return;
		if (selectedMailbox?.id === loadedDraftMailboxId) return;

		const draftMailbox = mailboxes.find((mailbox) => mailbox.id === loadedDraftMailboxId);
		if (draftMailbox) setSelectedMailbox(draftMailbox);
	}, [loadedDraftMailboxId, mailboxes, selectedMailbox?.id, setSelectedMailbox]);

	useEffect(() => {
		if (!loadedDraftFrom || !senderAddresses.includes(loadedDraftFrom)) return;
		setSelectedFrom(loadedDraftFrom);
	}, [loadedDraftFrom, senderAddresses]);

	useEffect(() => {
		if (loadingDraft) return;
		const nextSignature = selectedMailbox?.signature ?? "";
		setText((current) => applyMailboxSignature(current, previousSignature.current, nextSignature));
		previousSignature.current = nextSignature;
	}, [loadingDraft, selectedMailbox?.id, selectedMailbox?.signature]);

	useEffect(() => {
		const bodyContent = text.trim();
		const signatureOnly = bodyContent === (selectedMailbox?.signature?.trim() ?? "");
		const hasContent = to.trim() || subject.trim() || (bodyContent && !signatureOnly);
		if (!fromAddr || !hasContent || loadingDraft) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);

		saveTimer.current = setTimeout(() => {
			const save = (async () => {
				const payload = {
					mailboxId: selectedMailbox?.id,
					from: fromAddr,
					to,
					subject,
					text,
					replyToMessageId,
				};
				const res = await authFetch(draftId ? `/api/drafts/${draftId}` : "/api/drafts", {
					method: draftId ? "PATCH" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				const data = (await res.json()) as { draft?: { id: string } };
				if (res.ok && data.draft?.id) {
					setDraftId(data.draft.id);
					return data.draft.id;
				}
				return draftId;
			})().catch(() => draftId);
			draftSave.current = save;
		}, 900);

		return () => {
			if (saveTimer.current) clearTimeout(saveTimer.current);
		};
	}, [
		draftId,
		fromAddr,
		loadingDraft,
		replyToMessageId,
		selectedMailbox?.id,
		selectedMailbox?.signature,
		subject,
		text,
		to,
	]);

	function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!fromAddr || loadingDraft) return;
		const message = {
			to,
			subject,
			text,
			attachments,
			mailboxId: selectedMailbox?.id ?? null,
			selectedFrom,
			from: fromAddr,
			undoDelaySeconds,
			replyToMessageId,
		};
		const fingerprint = snapshotFingerprint(message);
		if (pendingSend.current?.fingerprint !== fingerprint) {
			pendingSend.current = { fingerprint, key: crypto.randomUUID() };
		}
		// An autosave still in flight may create the draft this send should delete.
		if (saveTimer.current) clearTimeout(saveTimer.current);
		const settledDraftId = (draftSave.current ?? Promise.resolve(draftId)).then(
			(savedId) => savedId ?? draftId,
		);
		sendWithUndo({
			snapshot: { ...message, sendKey: pendingSend.current.key },
			draftId: settledDraftId,
			restore: restoreComposer,
		});

		if (mode === "popup") {
			onClose?.();
			return;
		}
		pendingSend.current = null;
		draftSave.current = null;
		setDraftId(null);
		setReplyToMessageId(null);
		setTo("");
		setSubject("");
		setText(applyMailboxSignature("", "", selectedMailbox?.signature));
		setAttachments([]);
	}

	function addAttachments(files: FileList | null) {
		if (!files) return;
		const nextFiles = Array.from(files);
		const nextCount = attachments.length + nextFiles.length;
		const totalSize = [...attachments.map((attachment) => attachment.file), ...nextFiles].reduce(
			(total, file) => total + file.size,
			0,
		);

		if (nextCount > 10) {
			showComposeError("A message can include at most 10 attachments");
			return;
		}
		if (nextFiles.some((file) => file.size > 10 * 1024 * 1024)) {
			showComposeError("Each attachment must be 10 MB or smaller");
			return;
		}
		if (totalSize > 20 * 1024 * 1024) {
			showComposeError("Attachments must total 20 MB or less");
			return;
		}

		setAttachments((current) => [
			...current,
			...nextFiles.map((file) => ({ id: crypto.randomUUID(), file })),
		]);
		if (attachmentInput.current) attachmentInput.current.value = "";
	}

	function selectSender(value: string) {
		const option = senderOptions.find((item) => `${item.mailbox.id}|${item.address}` === value);
		if (!option) return;
		setSelectedFrom(option.address);
		if (selectedMailbox?.id !== option.mailbox.id) setSelectedMailbox(option.mailbox);
	}

	const frameClass =
		mode === "popup"
			? "fixed bottom-4 right-4 z-40 flex h-[min(520px,calc(100vh-88px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl"
			: "flex h-full min-h-[720px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm";

	return (
		<form onSubmit={onSubmit} className={frameClass}>
			<div className="flex h-9 items-center justify-between bg-primary px-4 text-sm font-medium text-primary-foreground">
				<span>{loadingDraft ? "Loading draft" : draftId ? "Draft saved" : "New Message"}</span>
				{mode === "popup" && (
					<div className="flex items-center gap-1 text-primary-foreground/70">
						<Minimize2 className="h-4 w-4" />
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="rounded-sm p-1 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground"
						>
							<X className="h-4 w-4" />
						</button>
					</div>
				)}
			</div>
			<div className="border-b border-neutral-100 px-4 py-1">
				<Label htmlFor={`${mode}-from`} className="sr-only">
					From
				</Label>
				<Select
					value={selectedMailbox && selectedFrom ? `${selectedMailbox.id}|${selectedFrom}` : ""}
					onValueChange={(value) => selectSender(value as string)}
					disabled={loadingDraft || senderOptions.length === 0}
				>
					<SelectTrigger
						id={`${mode}-from`}
						size="sm"
						className="h-8 w-fit max-w-full border-0 px-2 font-normal shadow-none hover:bg-muted focus-visible:ring-0"
					>
						<SelectValue>
							{(value) =>
								senderOptions.find(({ mailbox, address }) => `${mailbox.id}|${address}` === value)
									?.address ?? "Select a mailbox first"
							}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{senderOptions.map(({ mailbox, address }) => (
							<SelectItem key={`${mailbox.id}|${address}`} value={`${mailbox.id}|${address}`}>
								{address}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<div className="border-b border-neutral-100 px-4 py-1">
				<Label htmlFor={`${mode}-to`} className="sr-only">
					To
				</Label>
				<Input
					id={`${mode}-to`}
					value={to}
					onChange={(event) => setTo(event.target.value)}
					type="text"
					placeholder='Recipients, or "Maya Chen" <maya@example.com>'
					required
					disabled={loadingDraft}
					className="h-8 border-0 px-0 py-1 shadow-none focus-visible:ring-0"
				/>
			</div>
			<div className="border-b border-neutral-100 px-4 py-1">
				<Label htmlFor={`${mode}-subject`} className="sr-only">
					Subject
				</Label>
				<Input
					id={`${mode}-subject`}
					value={subject}
					onChange={(event) => setSubject(event.target.value)}
					placeholder="Subject"
					required
					disabled={loadingDraft}
					className="h-8 border-0 px-0 py-1 shadow-none focus-visible:ring-0"
				/>
			</div>
			<div className="min-h-0 flex-1 px-4 py-2">
				<Label htmlFor={`${mode}-text`} className="sr-only">
					Body
				</Label>
				<Textarea
					id={`${mode}-text`}
					value={text}
					onChange={(event) => setText(event.target.value)}
					disabled={loadingDraft}
					className="h-full min-h-full resize-none border-0 px-0 shadow-none focus-visible:ring-0"
				/>
			</div>
			{attachments.length > 0 && (
				<div className="flex flex-wrap gap-2 border-t border-neutral-100 px-4 py-3">
					{attachments.map((attachment) => (
						<div
							key={attachment.id}
							className="flex max-w-full items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
						>
							<FileText className="h-4 w-4 shrink-0 text-neutral-500" />
							<span className="max-w-48 truncate">{attachment.file.name}</span>
							<span className="text-xs text-neutral-400">
								{formatAttachmentSize(attachment.file.size)}
							</span>
							<button
								type="button"
								onClick={() =>
									setAttachments((current) => current.filter((item) => item.id !== attachment.id))
								}
								className="rounded-full p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
							>
								<X className="h-3.5 w-3.5" />
								<span className="sr-only">Remove attachment</span>
							</button>
						</div>
					))}
				</div>
			)}
			<div className="flex items-center gap-3 border-t border-neutral-100 px-4 py-3">
				<Input
					ref={attachmentInput}
					type="file"
					multiple
					className="hidden"
					onChange={(event) => addAttachments(event.target.files)}
				/>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => attachmentInput.current?.click()}
					disabled={loadingDraft}
				>
					<Paperclip className="h-4 w-4" />
					Attach
				</Button>
				<span className="flex-1" />
				<p className="text-xs text-neutral-500">
					{draftId ? "Saved to drafts" : "Autosaves as draft"}
				</p>
				<Select
					value={undoDelaySeconds}
					onValueChange={(value) => setUndoDelaySeconds(value as string)}
				>
					<SelectTrigger size="sm" className="w-28" aria-label="Undo Send delay">
						<SelectValue>{(value) => `Undo: ${String(value)}s`}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{[5, 10, 20, 30].map((seconds) => (
							<SelectItem key={seconds} value={String(seconds)}>
								Undo: {seconds}s
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button type="submit" disabled={loadingDraft || !fromAddr} className="rounded-full px-5">
					<Send className="h-4 w-4" />
					Send
				</Button>
			</div>
		</form>
	);
}

function snapshotFingerprint(message: Omit<ComposeSnapshot, "sendKey" | "draftId">): string {
	return JSON.stringify([
		message.replyToMessageId ?? null,
		message.from,
		message.to,
		message.subject,
		message.text,
		message.undoDelaySeconds,
		message.attachments.map((attachment) => attachment.id),
	]);
}
