"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
	ChevronDown,
	Forward,
	Paperclip,
	PenLine,
	Reply,
	SquareArrowOutUpRight,
	Trash2,
} from "lucide-react";
import { useCompose } from "@/components/compose/compose-context";
import { AttachmentList } from "@/components/compose/attachment-list";
import { RecipientField } from "@/components/compose/recipient-field";
import { sendWithUndo } from "@/components/compose/send-with-undo";
import type { ComposeAttachment, ComposeSnapshot } from "@/components/compose/types";
import { getAttachmentLimitError } from "@/components/compose/utils";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { buildReplyQuote, buildReplySubject } from "@/components/message-actions/utils";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import type { MessageDetailResponse } from "@/app/(dashboard)/inbox/[messageId]/types";
import { fetchMessageDetail } from "@/app/(dashboard)/inbox/[messageId]/utils";
import type { Message } from "@/hooks/types";
import { formatEmailAddress } from "@/lib/email/address";
import {
	normalizeRecipients,
	parseRecipientList,
	RecipientValidationError,
} from "@/lib/email/recipients";
import { htmlToReadableText } from "@/lib/email/reply-content-utils";
import { getUndoSendDelayPreference } from "@/lib/email/undo-send-preference";
import { cn } from "@/lib/utils";
import { SenderAvatar } from "./conversation-message";
import { buildForwardSubject, buildForwardText, getReplyAddresses } from "./conversation-utils";
import type { ReplyMode } from "./types";

const MODE_OPTIONS: Array<{ mode: ReplyMode; label: string; icon: typeof Reply }> = [
	{ mode: "reply", label: "Reply", icon: Reply },
	{ mode: "forward", label: "Forward", icon: Forward },
];

/** `Alex Doe (alex@example.com), sam@example.com`, the way Gmail summarises a reply's recipients. */
function summarizeRecipients(...headers: string[]): string {
	return headers
		.flatMap((header): Array<{ name: string | null; address: string }> => {
			try {
				return parseRecipientList(header);
			} catch {
				return header.trim() ? [{ name: null, address: header.trim() }] : [];
			}
		})
		.map((recipient) =>
			recipient.name ? `${recipient.name} (${recipient.address})` : recipient.address,
		)
		.join(", ");
}

/** Reply or forward inside the conversation, sent with the same Undo Send flow as the composer. */
export function InlineReply({
	mode: initialMode,
	target,
	subject,
	detail,
	onClose,
}: Readonly<{
	mode: ReplyMode;
	target: Message;
	subject: string | null;
	detail: MessageDetailResponse | null;
	onClose: () => void;
}>) {
	const { mailboxes, selectedMailbox } = useSelectedMailbox();
	const { restoreComposer } = useCompose();
	const addresses = getReplyAddresses(target);
	const [mode, setMode] = useState(initialMode);
	const [to, setTo] = useState(initialMode === "reply" ? addresses.to : "");
	const [cc, setCc] = useState(initialMode === "reply" ? addresses.cc : "");
	// Replies start with a one-line summary; forwards need an address typed straight away.
	const [editingRecipients, setEditingRecipients] = useState(initialMode === "forward");
	const [showCc, setShowCc] = useState(Boolean(initialMode === "reply" && addresses.cc));
	const [showQuote, setShowQuote] = useState(false);
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [preparing, setPreparing] = useState(false);
	const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
	const [includeSignature, setIncludeSignature] = useState(true);
	const [dragging, setDragging] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const recipientInputRef = useRef<HTMLInputElement>(null);
	const ccInputRef = useRef<HTMLInputElement>(null);
	const bodyInputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (editingRecipients && !to) recipientInputRef.current?.focus();
		else bodyInputRef.current?.focus();
		// Focus follows mode changes only, not every keystroke in the To field.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [mode]);

	function changeMode(next: ReplyMode) {
		if (next === mode) return;
		setMode(next);
		setError(null);
		if (next === "forward") {
			setTo("");
			setCc("");
			setShowCc(false);
			setEditingRecipients(true);
		} else {
			setTo(addresses.to);
			setCc(addresses.cc);
			setShowCc(Boolean(addresses.cc));
			setEditingRecipients(false);
		}
	}

	const mailbox = mailboxes.find((item) => item.id === target.mailboxId) ?? selectedMailbox;
	const sender = useMemo(() => {
		if (!mailbox || mailbox.permission === "read_only") return null;
		const options = mailbox.senderAddresses?.length
			? mailbox.senderAddresses
			: [`${mailbox.localPart}@${mailbox.hostname}`];
		const own = addresses.own.toLowerCase();
		const address = options.find((option) => option.toLowerCase() === own) ?? options[0];
		return { mailbox, address, from: formatEmailAddress(address, mailbox.displayName) };
	}, [addresses.own, mailbox]);

	const hasSignature = Boolean(
		mailbox?.signatureHtml || mailbox?.signatureText || mailbox?.signature,
	);

	function addAttachments(list: FileList | null) {
		const files = Array.from(list ?? []);
		if (fileInputRef.current) fileInputRef.current.value = "";
		if (files.length === 0) return;
		const limitError = getAttachmentLimitError(
			attachments.map((attachment) => attachment.file),
			files,
		);
		if (limitError) {
			setError(limitError);
			return;
		}
		setError(null);
		setAttachments((current) => [
			...current,
			...files.map((file) => ({ id: crypto.randomUUID(), file })),
		]);
	}

	const cachedSource =
		detail?.body?.textBody || htmlToReadableText(detail?.body?.htmlBody) || target.snippet;
	const quotePreview = (
		mode === "reply"
			? buildReplyQuote(target.fromAddr, cachedSource)
			: buildForwardText(target, cachedSource)
	).trim();

	async function buildSnapshot(): Promise<ComposeSnapshot | null> {
		if (!sender) {
			setError("You can’t send from this mailbox.");
			return null;
		}
		const sourceDetail = detail?.body
			? detail
			: await fetchMessageDetail(target.id).catch(() => null);
		const sourceText =
			sourceDetail?.body?.textBody ||
			htmlToReadableText(sourceDetail?.body?.htmlBody) ||
			target.snippet;
		return {
			to: to.trim(),
			cc: cc.trim(),
			subject: mode === "reply" ? buildReplySubject(subject) : buildForwardSubject(subject),
			text:
				mode === "reply"
					? `${body}${buildReplyQuote(target.fromAddr, sourceText)}`
					: `${body}${buildForwardText(target, sourceText)}`,
			attachments,
			includeSignature: hasSignature ? includeSignature : undefined,
			mailboxId: sender.mailbox.id,
			selectedFrom: sender.address,
			from: sender.from,
			undoDelaySeconds: String(getUndoSendDelayPreference()),
			sendKey: crypto.randomUUID(),
			replyToMessageId: mode === "reply" ? target.id : null,
		};
	}

	async function send() {
		setError(null);
		try {
			const recipients = normalizeRecipients({ to, cc });
			setTo(recipients.toHeader);
			setCc(recipients.ccHeader);
		} catch (reason) {
			setEditingRecipients(true);
			setError(
				reason instanceof RecipientValidationError ? reason.message : "Add valid recipients.",
			);
			return;
		}
		setPreparing(true);
		const snapshot = await buildSnapshot();
		setPreparing(false);
		if (!snapshot) return;
		sendWithUndo({ snapshot, draftId: Promise.resolve(null), restore: restoreComposer });
		onClose();
	}

	async function popOut() {
		setPreparing(true);
		const snapshot = await buildSnapshot();
		setPreparing(false);
		if (!snapshot) return;
		restoreComposer(snapshot);
		onClose();
	}

	const current = MODE_OPTIONS.find((option) => option.mode === mode) ?? MODE_OPTIONS[0];
	const summary = summarizeRecipients(to, cc);

	return (
		<div className="flex items-start gap-3">
			{sender && (
				<span className="hidden sm:block">
					<SenderAvatar
						name={sender.mailbox.displayName ?? sender.address}
						address={sender.address}
					/>
				</span>
			)}
			<form
				className={cn(
					"relative min-w-0 flex-1 rounded-2xl bg-white shadow-[0_1px_3px_rgb(60_64_67/0.3),0_4px_8px_3px_rgb(60_64_67/0.15)]",
					dragging && "ring-2 ring-primary/40",
				)}
				onDragOver={(event) => {
					if (!event.dataTransfer.types.includes("Files")) return;
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={(event) => {
					if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
				}}
				onDrop={(event) => {
					if (!event.dataTransfer.files.length) return;
					event.preventDefault();
					setDragging(false);
					addAttachments(event.dataTransfer.files);
				}}
				onSubmit={(event) => {
					event.preventDefault();
					void send();
				}}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						void send();
					}
					if (event.key === "Escape" && !body.trim()) onClose();
				}}
			>
				<div className="flex items-start gap-1 px-3 pt-2">
					<DropdownMenu>
						<DropdownMenuTrigger
							aria-label={`${current.label}. Change reply type`}
							render={
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="h-8 shrink-0 gap-0.5 rounded-full px-2 text-neutral-600"
								/>
							}
						>
							<current.icon className="size-4" />
							<ChevronDown className="size-3" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" className="w-40">
							{MODE_OPTIONS.map((option) => (
								<DropdownMenuItem key={option.mode} onClick={() => changeMode(option.mode)}>
									<option.icon className="size-4" />
									{option.label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>

					<div className="min-w-0 flex-1 text-sm">
						{editingRecipients ? (
							<div className="-mt-0.5">
								<div className="flex items-start gap-1">
									<div className="min-w-0 flex-1">
										<RecipientField
											id="inline-reply-to"
											label="To"
											value={to}
											onChange={(value) => {
												setTo(value);
												setError(null);
											}}
											inputRef={recipientInputRef}
											required
										/>
									</div>
									{!showCc && (
										<button
											type="button"
											onClick={() => {
												setShowCc(true);
												requestAnimationFrame(() => ccInputRef.current?.focus());
											}}
											className="mt-2 rounded px-1.5 py-1 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
										>
											Cc
										</button>
									)}
								</div>
								{showCc && (
									<RecipientField
										id="inline-reply-cc"
										label="Cc"
										value={cc}
										onChange={(value) => {
											setCc(value);
											setError(null);
										}}
										inputRef={ccInputRef}
									/>
								)}
							</div>
						) : (
							<button
								type="button"
								onClick={() => {
									setEditingRecipients(true);
									requestAnimationFrame(() => recipientInputRef.current?.focus());
								}}
								title="Edit recipients"
								className="block h-8 w-full truncate rounded px-1 text-left text-neutral-800 hover:bg-neutral-50"
							>
								{summary || "Add recipients"}
							</button>
						)}
					</div>

					<Tooltip label="Pop out reply">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Pop out reply"
							disabled={preparing || !sender}
							onClick={() => void popOut()}
							className="shrink-0 rounded-full text-neutral-600"
						>
							<SquareArrowOutUpRight className="size-4" />
						</Button>
					</Tooltip>
				</div>

				<label htmlFor="inline-reply-body" className="sr-only">
					Message
				</label>
				<Textarea
					ref={bodyInputRef}
					id="inline-reply-body"
					value={body}
					onChange={(event) => setBody(event.target.value)}
					className="max-h-[50vh] min-h-24 resize-none rounded-none border-0 bg-transparent px-4 py-2 text-sm shadow-none focus-visible:ring-0"
				/>

				{quotePreview && (
					<div className="px-4 pb-1">
						<button
							type="button"
							aria-expanded={showQuote}
							aria-label={showQuote ? "Hide quoted text" : "Show quoted text"}
							title={showQuote ? "Hide quoted text" : "Show quoted text"}
							onClick={() => setShowQuote((value) => !value)}
							className={cn(
								"inline-flex h-3.5 items-center rounded-sm px-1.5 text-[11px] leading-none tracking-widest text-neutral-600 hover:bg-neutral-300",
								showQuote ? "bg-neutral-300" : "bg-neutral-200",
							)}
						>
							•••
						</button>
						{showQuote && (
							<pre className="mt-2 max-h-60 overflow-y-auto font-sans text-xs whitespace-pre-wrap text-neutral-500">
								{quotePreview}
							</pre>
						)}
					</div>
				)}

				<AttachmentList
					attachments={attachments}
					onRemove={(id) => setAttachments((items) => items.filter((item) => item.id !== id))}
					className="px-4 pt-2"
				/>

				{error && (
					<p role="alert" className="px-4 pt-1 text-sm text-red-600">
						{error}
					</p>
				)}

				<div className="flex items-center gap-2 px-3 pt-2 pb-3">
					<Tooltip label="Send (Ctrl+Enter)">
						<Button
							type="submit"
							className="h-9 rounded-full px-6 font-semibold"
							disabled={preparing || !sender}
						>
							Send
						</Button>
					</Tooltip>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="hidden"
						aria-label="Attach files"
						onChange={(event) => addAttachments(event.target.files)}
					/>
					<Tooltip label="Attach files">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Attach files"
							onClick={() => fileInputRef.current?.click()}
							className="ml-1 rounded-full text-neutral-600"
						>
							<Paperclip className="size-4" />
						</Button>
					</Tooltip>
					{hasSignature && (
						<Tooltip label={includeSignature ? "Signature included" : "Signature left off"}>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Include signature"
								aria-pressed={includeSignature}
								onClick={() => setIncludeSignature((value) => !value)}
								className={cn(
									"rounded-full",
									includeSignature ? "bg-primary/10 text-primary" : "text-neutral-600",
								)}
							>
								<PenLine className="size-4" />
							</Button>
						</Tooltip>
					)}
					<span className="flex-1" />
					<Tooltip label="Discard">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Discard"
							onClick={onClose}
							className="rounded-full text-neutral-600"
						>
							<Trash2 className="size-4" />
						</Button>
					</Tooltip>
				</div>
			</form>
		</div>
	);
}
