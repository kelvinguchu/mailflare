"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Minimize2, Paperclip, Send, X } from "lucide-react";
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
import { getUndoSendDelayPreference } from "@/lib/email/undo-send-preference";
import { authFetch } from "@/lib/auth/client";
import { formatEmailAddress, getEmailAddress } from "@/lib/email/address";
import { useCompose } from "./compose-context";
import { sendWithUndo } from "./send-with-undo";
import { AttachmentList } from "./attachment-list";
import { fetchDraft, getAttachmentLimitError, removeLegacySignature } from "./utils";
import type { ComposeAttachment, ComposeSnapshot } from "./types";
import { RecipientField } from "./recipient-field";
import { normalizeRecipients, RecipientValidationError } from "@/lib/email/recipients";

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
	const [cc, setCc] = useState(initialSnapshot?.cc ?? "");
	const [showCc, setShowCc] = useState(Boolean(initialSnapshot?.cc));
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
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const draftSave = useRef<Promise<string | null> | null>(null);
	const attachmentInput = useRef<HTMLInputElement | null>(null);
	const recipientInput = useRef<HTMLInputElement | null>(null);
	const ccInput = useRef<HTMLInputElement | null>(null);
	const focusedRecipient = useRef(false);
	// Resending an unchanged message reuses its Idempotency-Key; any edit starts a new send.
	const pendingSend = useRef<{ fingerprint: string; key: string } | null>(
		initialSnapshot
			? { fingerprint: snapshotFingerprint(initialSnapshot), key: initialSnapshot.sendKey }
			: null,
	);

	useEffect(() => {
		if (!selectedMailbox && mailboxes.length === 1) setSelectedMailbox(mailboxes[0]);
	}, [mailboxes, selectedMailbox, setSelectedMailbox]);

	useEffect(() => {
		if (mode !== "popup" || loadingDraft || focusedRecipient.current) return;
		if (draftIdToLoad && !draftId) return;
		focusedRecipient.current = true;
		recipientInput.current?.focus();
	}, [draftId, draftIdToLoad, loadingDraft, mode]);

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
				setCc(draft.ccAddr);
				setShowCc(Boolean(draft.ccAddr));
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
		setText((current) => removeLegacySignature(current, selectedMailbox?.signature));
	}, [loadingDraft, selectedMailbox?.id, selectedMailbox?.signature]);

	useEffect(() => {
		const bodyContent = text.trim();
		const hasContent = to.trim() || cc.trim() || subject.trim() || bodyContent;
		if (!fromAddr || !hasContent || loadingDraft) return;
		if (saveTimer.current) clearTimeout(saveTimer.current);

		saveTimer.current = setTimeout(() => {
			const save = (async () => {
				const payload = {
					mailboxId: selectedMailbox?.id,
					from: fromAddr,
					to,
					cc,
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
		cc,
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
		let recipients;
		try {
			recipients = normalizeRecipients({ to, cc });
		} catch (error) {
			showComposeError(
				error instanceof RecipientValidationError ? error.message : "Add valid recipients",
			);
			recipientInput.current?.focus();
			return;
		}
		const message = {
			to: recipients.toHeader,
			cc: recipients.ccHeader,
			subject,
			text,
			attachments,
			mailboxId: selectedMailbox?.id ?? null,
			selectedFrom,
			from: fromAddr,
			undoDelaySeconds: String(getUndoSendDelayPreference()),
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
		setCc("");
		setShowCc(false);
		setSubject("");
		setText("");
		setAttachments([]);
	}

	function addAttachments(files: FileList | null) {
		if (!files) return;
		const nextFiles = Array.from(files);
		const limitError = getAttachmentLimitError(
			attachments.map((attachment) => attachment.file),
			nextFiles,
		);
		if (limitError) {
			showComposeError(limitError);
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
			? "fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex h-[min(520px,calc(100dvh-88px))] w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-2xl max-sm:right-2 max-sm:left-2 max-sm:w-auto"
			: "flex h-full min-h-[720px] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm";

	return (
		<form onSubmit={onSubmit} className={frameClass}>
			<div className="flex h-9 items-center justify-between bg-primary px-4 text-sm font-medium text-primary-foreground">
				<span role="status" aria-live="polite">
					{loadingDraft ? "Loading draft…" : draftId ? "Draft saved" : "New Message"}
				</span>
				{mode === "popup" && (
					<div className="flex items-center gap-1 text-primary-foreground/70">
						<Minimize2 aria-hidden="true" className="h-4 w-4" />
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="rounded-sm p-1 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary-foreground/70"
						>
							<X aria-hidden="true" className="h-4 w-4" />
						</button>
					</div>
				)}
			</div>
			<div className="border-b border-neutral-100 px-4 py-1">
				<Label htmlFor={`${mode}-from`} className="sr-only">
					From
				</Label>
				<Select
					name="from"
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
			<div className="border-b border-neutral-100 px-4">
				<div className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						<RecipientField
							id={`${mode}-to`}
							label="To"
							value={to}
							onChange={setTo}
							inputRef={recipientInput}
							required
							disabled={loadingDraft}
						/>
					</div>
					<button
						type="button"
						aria-expanded={showCc}
						aria-controls={`${mode}-cc-row`}
						onClick={() => {
							setShowCc((current) => !current);
							if (!showCc) requestAnimationFrame(() => ccInput.current?.focus());
						}}
						className="mt-2 rounded px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:ring-2 focus-visible:ring-primary/40"
					>
						Cc
					</button>
				</div>
				{showCc && (
					<div id={`${mode}-cc-row`}>
						<RecipientField
							id={`${mode}-cc`}
							label="Cc"
							value={cc}
							onChange={setCc}
							inputRef={ccInput}
							disabled={loadingDraft}
						/>
					</div>
				)}
			</div>
			<div className="border-b border-neutral-100 px-4 py-1">
				<Label htmlFor={`${mode}-subject`} className="sr-only">
					Subject
				</Label>
				<Input
					id={`${mode}-subject`}
					name="subject"
					autoComplete="off"
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
					name="body"
					autoComplete="off"
					value={text}
					onChange={(event) => setText(event.target.value)}
					disabled={loadingDraft}
					className="h-full min-h-full resize-none border-0 px-0 shadow-none focus-visible:ring-0"
				/>
			</div>
			<AttachmentList
				attachments={attachments}
				onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))}
				className="border-t border-neutral-100 px-4 py-3"
			/>
			<div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-3">
				<Input
					ref={attachmentInput}
					name="attachments"
					aria-label="Add attachments"
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
					<Paperclip aria-hidden="true" className="h-4 w-4" />
					Attach
				</Button>
				<p
					className="order-last w-full text-xs text-neutral-500 sm:order-none sm:w-auto sm:flex-1"
					aria-live="polite"
				>
					{draftId ? "Saved to drafts" : "Autosaves as draft"}
				</p>
				<Button type="submit" disabled={loadingDraft || !fromAddr} className="rounded-full px-5">
					<Send aria-hidden="true" className="h-4 w-4" />
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
		message.cc,
		message.subject,
		message.text,
		message.undoDelaySeconds,
		message.attachments.map((attachment) => attachment.id),
	]);
}
