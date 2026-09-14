"use client";

import { useMemo, useState } from "react";
import { Forward, Maximize2, Reply, Send, Trash2 } from "lucide-react";
import { useCompose } from "@/components/compose/compose-context";
import { sendWithUndo } from "@/components/compose/send-with-undo";
import type { ComposeSnapshot } from "@/components/compose/types";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { buildReplyQuote, buildReplySubject } from "@/components/message-actions/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import type { MessageDetailResponse } from "@/app/(dashboard)/inbox/[messageId]/types";
import { fetchMessageDetail } from "@/app/(dashboard)/inbox/[messageId]/utils";
import type { Message } from "@/hooks/types";
import { formatEmailAddress } from "@/lib/email/address";
import { htmlToReadableText } from "@/lib/email/reply-content-utils";
import {
	buildForwardSubject,
	buildForwardText,
	getReplyAddresses,
	getSenderName,
} from "./conversation-utils";
import type { ReplyMode } from "./types";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/** Reply or forward inside the conversation, sent with the same Undo Send flow as the composer. */
export function InlineReply({
	mode,
	target,
	subject,
	detail,
	onClose,
}: {
	mode: ReplyMode;
	target: Message;
	subject: string | null;
	detail: MessageDetailResponse | null;
	onClose: () => void;
}) {
	const { mailboxes, selectedMailbox } = useSelectedMailbox();
	const { restoreComposer } = useCompose();
	const addresses = getReplyAddresses(target);
	const [to, setTo] = useState(mode === "reply" ? addresses.to : "");
	const [body, setBody] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [preparing, setPreparing] = useState(false);

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
			subject: mode === "reply" ? buildReplySubject(subject) : buildForwardSubject(subject),
			text:
				mode === "reply"
					? `${body}${buildReplyQuote(target.fromAddr, sourceText)}`
					: `${body}${buildForwardText(target, sourceText)}`,
			attachments: [],
			mailboxId: sender.mailbox.id,
			selectedFrom: sender.address,
			from: sender.from,
			undoDelaySeconds: "10",
			sendKey: crypto.randomUUID(),
			replyToMessageId: mode === "reply" ? target.id : null,
		};
	}

	async function send() {
		setError(null);
		if (!EMAIL_PATTERN.test(to.trim())) {
			setError("Add a valid recipient.");
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

	const ModeIcon = mode === "reply" ? Reply : Forward;

	return (
		<form
			className="rounded-2xl border border-neutral-200 bg-white shadow-sm focus-within:border-neutral-300 focus-within:shadow-md"
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
			<div className="flex items-center gap-2 border-b border-neutral-100 px-4 py-2 text-sm">
				<ModeIcon className="size-4 shrink-0 text-neutral-500" aria-hidden="true" />
				<label htmlFor="inline-reply-to" className="sr-only">
					To
				</label>
				<input
					id="inline-reply-to"
					type="email"
					value={to}
					onChange={(event) => {
						setTo(event.target.value);
						setError(null);
					}}
					placeholder="Recipients"
					autoFocus={mode === "forward"}
					className="min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-neutral-400"
				/>
				{mode === "reply" && (
					<span className="hidden shrink-0 text-xs text-neutral-400 sm:inline">
						Replying to {getSenderName(target)}
					</span>
				)}
			</div>
			<label htmlFor="inline-reply-body" className="sr-only">
				Message
			</label>
			<Textarea
				id="inline-reply-body"
				value={body}
				onChange={(event) => setBody(event.target.value)}
				autoFocus={mode === "reply"}
				rows={5}
				className="min-h-32 resize-y rounded-none border-0 px-4 py-3 shadow-none focus-visible:ring-0"
			/>
			<p className="px-4 pb-2 text-xs text-neutral-400">
				{mode === "reply"
					? "The earlier message is quoted below your reply."
					: "The original message is included."}
			</p>
			{error && (
				<p role="alert" className="px-4 pb-2 text-sm text-red-600">
					{error}
				</p>
			)}
			<div className="flex items-center gap-2 border-t border-neutral-100 px-3 py-2.5">
				<Button type="submit" className="rounded-full px-5" disabled={preparing || !sender}>
					<Send className="size-4" />
					Send
				</Button>
				<span className="hidden text-xs text-neutral-400 sm:inline">Ctrl + Enter</span>
				<span className="flex-1" />
				<Tooltip label="Open in full composer">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Open in full composer"
						disabled={preparing || !sender}
						onClick={() => void popOut()}
					>
						<Maximize2 className="size-4" />
					</Button>
				</Tooltip>
				<Tooltip label="Discard">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Discard"
						onClick={onClose}
					>
						<Trash2 className="size-4" />
					</Button>
				</Tooltip>
			</div>
		</form>
	);
}
