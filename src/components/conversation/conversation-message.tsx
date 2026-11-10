"use client";

import { useEffect, useState } from "react";
import {
	AlertTriangle,
	Cloud,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Forward,
	ImageOff,
	Paperclip,
	Reply,
	Star,
} from "lucide-react";
import { ContactDetailsTrigger } from "@/components/contacts/contact-details";
import { MessageAttachmentCard } from "@/components/message-attachment-card";
import { MessageAttachmentViewer } from "@/components/message-attachment-viewer";
import { toggleMessageStar } from "@/components/messages/message-list-row-actions-utils";
import { PreviousMessage } from "@/components/previous-message";
import { EmailHtmlBody } from "./email-html-body";
import { useRemoteImageSenders } from "./use-remote-image-senders";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { extractCloudAttachments } from "@/app/(dashboard)/inbox/[messageId]/cloud-attachment-utils";
import { sanitizeEmailHtml } from "@/app/(dashboard)/inbox/[messageId]/email-html-sanitizer";
import type {
	MessageAttachment,
	MessageDetailResponse,
} from "@/app/(dashboard)/inbox/[messageId]/types";
import {
	fetchMessageDetail,
	fetchMessageMetadata,
	getCachedMessageDetailForDisplay,
	getMessageBodyDisplay,
	getMessageHeaderParties,
	resolveInlineAttachmentUrls,
} from "@/app/(dashboard)/inbox/[messageId]/utils";
import type { Message } from "@/hooks/types";
import { getMessagePreviewText } from "@/lib/email/reply-content-utils";
import { cn } from "@/lib/utils";
import {
	formatCollapsedDate,
	formatConversationDate,
	getAvatarColor,
	getAvatarInitials,
	getSenderName,
	isUnreadMessage,
} from "./conversation-utils";

const DELIVERY_LABELS: Record<string, string> = {
	scheduled: "Scheduled",
	queued: "Queued",
	sending: "Sending",
	accepted: "Provider accepted",
	delivered: "Delivered",
	failed: "Not delivered",
	suppressed: "Not delivered",
	canceled: "Canceled",
	unknown: "Status unknown",
};

export function SenderAvatar({ name, address }: { name: string; address: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
				getAvatarColor(address),
			)}
		>
			{getAvatarInitials(name)}
		</span>
	);
}

export function CollapsedConversationMessage({
	message,
	onExpand,
}: {
	message: Message;
	onExpand: () => void;
}) {
	const name = getSenderName(message);
	const unread = isUnreadMessage(message);
	return (
		<button
			type="button"
			onClick={onExpand}
			className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 sm:px-6"
		>
			<SenderAvatar name={name} address={message.fromAddr} />
			<span className="min-w-0 flex-1">
				<span className="flex items-center gap-2">
					<span
						className={cn(
							"min-w-0 flex-1 truncate text-sm text-neutral-900",
							unread ? "font-bold" : "font-semibold",
						)}
					>
						{name}
					</span>
					{message.hasAttachments && (
						<Paperclip
							aria-label="Has attachments"
							className="size-3.5 shrink-0 text-neutral-500"
						/>
					)}
					<span
						className={cn(
							"shrink-0 text-xs",
							unread ? "font-semibold text-neutral-900" : "text-neutral-500",
						)}
					>
						{formatCollapsedDate(message.createdAt)}
					</span>
				</span>
				<span className="mt-0.5 block truncate text-sm text-neutral-600">
					{getMessagePreviewText(message.snippet) || message.snippet}
				</span>
			</span>
		</button>
	);
}

export function ExpandedConversationMessage({
	message,
	currentAccountName,
	collapsible,
	onCollapse,
	onReply,
	onForward,
	inspection,
}: {
	inspection?: MessageDetailResponse;
	message: Message;
	currentAccountName?: string;
	collapsible: boolean;
	onCollapse: () => void;
	onReply: (message: Message, detail: MessageDetailResponse | null) => void;
	onForward: (message: Message, detail: MessageDetailResponse | null) => void;
}) {
	const [data, setData] = useState<MessageDetailResponse | null>(
		() => inspection ?? getCachedMessageDetailForDisplay(message.id) ?? null,
	);
	const [loadError, setLoadError] = useState(false);
	const [starred, setStarred] = useState(message.starred);
	const [previewAttachment, setPreviewAttachment] = useState<MessageAttachment | null>(null);
	const [remoteImagesAllowed, setRemoteImagesAllowed] = useState(false);
	const [savingImageChoice, setSavingImageChoice] = useState(false);
	const remoteImageSenders = useRemoteImageSenders(inspection ? null : message.mailboxId);
	const imagesTrustedBySender =
		!inspection &&
		message.direction === "inbound" &&
		remoteImageSenders.isAllowed(message.fromAddr);
	const [showDetails, setShowDetails] = useState(false);

	useEffect(() => setStarred(message.starred), [message.starred]);

	useEffect(() => {
		if (inspection) {
			setData(inspection);
			return;
		}
		let cancelled = false;
		const cached = getCachedMessageDetailForDisplay(message.id);
		async function load() {
			try {
				if (cached?.message && cached.body) {
					if (cached.attachments !== undefined) return;
					const metadata = await fetchMessageMetadata(message.id);
					if (!cancelled) setData((current) => (current ? { ...current, ...metadata } : current));
					return;
				}
				const detail = await fetchMessageDetail(message.id);
				if (!cancelled) setData(detail);
			} catch {
				if (!cancelled && !cached) setLoadError(true);
			}
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, [message.id, inspection]);

	const detailMessage = data?.message ?? message;
	const attachments = data?.attachments ?? [];
	const { fromName, fromAddress, toName } = getMessageHeaderParties(
		detailMessage,
		currentAccountName,
	);
	const senderName = message.direction === "outbound" && !inspection ? "me" : fromName;
	const ownAddress =
		message.direction === "inbound"
			? (detailMessage.deliveredToAddr ?? message.toAddr)
			: message.fromAddr;
	const bodyDisplay = getMessageBodyDisplay(
		data?.body?.textBody,
		data?.body?.htmlBody,
		message.snippet,
		ownAddress,
	);
	const sanitizedHtml = sanitizeEmailHtml(
		inspection
			? (resolveInlineAttachmentUrls(bodyDisplay.htmlBody, message.id, attachments)?.replaceAll(
					"/api/messages/",
					"/api/team-inboxes/messages/",
				) ?? null)
			: resolveInlineAttachmentUrls(bodyDisplay.htmlBody, message.id, attachments),
		{
			allowRemoteImages: !inspection && (remoteImagesAllowed || imagesTrustedBySender),
			inspection: !!inspection,
		},
	);
	const cloudAttachments = extractCloudAttachments(bodyDisplay.latestContent);

	async function saveImageChoice(allowed: boolean) {
		setSavingImageChoice(true);
		// This message follows the click even when the choice can't be saved, for example in a
		// shared mailbox the account can read but not manage.
		setRemoteImagesAllowed(allowed);
		try {
			await remoteImageSenders.setAllowed(message.fromAddr, allowed);
		} catch {
			// The choice still applies to this message; it just isn't remembered.
		} finally {
			setSavingImageChoice(false);
		}
	}
	const deliveryLabel =
		message.direction === "outbound" && message.deliveryStatus
			? DELIVERY_LABELS[message.deliveryStatus]
			: null;

	return (
		<article className="px-4 py-4 sm:px-6" aria-label={`Message from ${senderName}`}>
			<header className="flex items-start gap-3">
				<SenderAvatar name={senderName} address={message.fromAddr} />
				<div className="min-w-0 flex-1">
					<p className="truncate text-sm text-neutral-900">
						<span className="font-semibold">
							{message.direction === "inbound" && !inspection ? (
								<ContactDetailsTrigger
									mailboxId={message.mailboxId}
									address={message.fromAddr}
									name={fromName}
								/>
							) : (
								fromName
							)}
						</span>{" "}
						<span className="text-xs text-neutral-500">&lt;{fromAddress}&gt;</span>
					</p>
					<p className="flex min-w-0 items-center text-xs text-neutral-500">
						<button
							type="button"
							aria-expanded={showDetails}
							title={showDetails ? "Hide details" : "Show details"}
							onClick={() => setShowDetails((value) => !value)}
							className="inline-flex min-w-0 items-center gap-0.5 rounded-sm hover:text-neutral-800 focus-visible:ring-2 focus-visible:ring-primary/40"
						>
							<span className="truncate">
								to {toName}
								{detailMessage.ccAddr ? ", …" : ""}
							</span>
							<ChevronDown
								aria-hidden="true"
								className={cn(
									"size-3.5 shrink-0 transition-transform",
									showDetails && "rotate-180",
								)}
							/>
						</button>
						{deliveryLabel && (
							<span
								className={cn(
									"ml-2 font-medium",
									message.deliveryStatus === "failed" || message.deliveryStatus === "suppressed"
										? "text-red-600"
										: "text-neutral-500",
								)}
							>
								· {deliveryLabel}
							</span>
						)}
					</p>
					<time
						dateTime={message.createdAt}
						className="block text-xs whitespace-nowrap text-neutral-500 sm:hidden"
					>
						{formatConversationDate(message.createdAt)}
					</time>
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					{collapsible && (
						<Tooltip label="Collapse message">
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="Collapse message"
								onClick={onCollapse}
							>
								<ChevronUp aria-hidden="true" className="size-4 text-neutral-600" />
							</Button>
						</Tooltip>
					)}
					<time
						dateTime={message.createdAt}
						className="mr-2 hidden text-xs whitespace-nowrap text-neutral-500 sm:block"
					>
						{formatConversationDate(message.createdAt)}
					</time>
					{!inspection && (
						<>
							{" "}
							<Tooltip label={starred ? "Starred" : "Not starred"}>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label={starred ? "Remove star" : "Star message"}
									onClick={() =>
										void toggleMessageStar(message.id)
											.then((result) => setStarred(result.starred))
											.catch(() => undefined)
									}
								>
									<Star
										className={cn(
											"size-4",
											starred ? "fill-amber-400 text-amber-400" : "text-neutral-400",
										)}
									/>
								</Button>
							</Tooltip>
							<Tooltip label="Reply">
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Reply"
									onClick={() => onReply(message, data)}
								>
									<Reply className="size-4 text-neutral-600" />
								</Button>
							</Tooltip>
							<Tooltip label="Forward">
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Forward"
									onClick={() => onForward(message, data)}
								>
									<Forward className="size-4 text-neutral-600" />
								</Button>
							</Tooltip>
						</>
					)}
				</div>
			</header>

			{showDetails && (
				<dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs sm:ml-13 sm:max-w-xl">
					<dt className="text-right text-neutral-500">from</dt>
					<dd className="break-words text-neutral-900">
						{fromName} &lt;{fromAddress}&gt;
					</dd>
					<dt className="text-right text-neutral-500">to</dt>
					<dd className="break-words text-neutral-900">{detailMessage.toAddr}</dd>
					{detailMessage.ccAddr && (
						<>
							<dt className="text-right text-neutral-500">cc</dt>
							<dd className="break-words text-neutral-900">{detailMessage.ccAddr}</dd>
						</>
					)}
					<dt className="text-right text-neutral-500">date</dt>
					<dd className="text-neutral-900">
						{new Date(message.createdAt).toLocaleString(undefined, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
					</dd>
				</dl>
			)}

			<div className="mt-4 sm:pl-13">
				{message.securityStatus === "quarantined" && (
					<div
						className="mb-4 flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-950"
						role="alert"
					>
						<AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
						<span>
							This message is quarantined. Its body and attachments are unavailable.{" "}
							{message.securityReason}
						</span>
					</div>
				)}
				{message.direction === "outbound" &&
					(message.deliveryStatus === "failed" || message.deliveryStatus === "suppressed") && (
						<div
							className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
							role="status"
						>
							This message wasn’t delivered. {message.deliveryDetail}
							{data?.delivery?.error ? ` ${data.delivery.error}` : ""}
						</div>
					)}
				{!inspection &&
					!remoteImageSenders.loading &&
					sanitizedHtml.blockedRemoteImageCount > 0 && (
						<div
							className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
							role="status"
						>
							<span className="flex items-center gap-2">
								<ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
								Remote images are hidden to protect your privacy.
							</span>
							<span className="flex flex-wrap items-center gap-x-4 gap-y-1">
								<button
									type="button"
									className="shrink-0 font-medium text-amber-950 underline underline-offset-2 hover:no-underline"
									onClick={() => setRemoteImagesAllowed(true)}
								>
									Display remote images
								</button>
								{message.direction === "inbound" && (
									<button
										type="button"
										disabled={savingImageChoice}
										className="shrink-0 font-medium text-amber-950 underline underline-offset-2 hover:no-underline disabled:opacity-60"
										onClick={() => void saveImageChoice(true)}
									>
										Always display from this sender
									</button>
								)}
							</span>
						</div>
					)}
				{imagesTrustedBySender && sanitizedHtml.remoteImageCount > 0 && (
					<p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
						<span>Remote images from {fromAddress} are always displayed.</span>
						<button
							type="button"
							disabled={savingImageChoice}
							className="font-medium text-neutral-700 underline underline-offset-2 hover:no-underline disabled:opacity-60"
							onClick={() => void saveImageChoice(false)}
						>
							Stop displaying them
						</button>
					</p>
				)}
				{loadError && !data ? (
					<p className="text-sm text-red-600">This message couldn’t be loaded.</p>
				) : (
					<div className="prose max-w-none text-neutral-900 max-md:min-w-0 max-md:[overflow-wrap:anywhere]">
						{sanitizedHtml.html ? (
							<EmailHtmlBody html={sanitizedHtml.html} />
						) : (
							<pre className="font-sans text-sm whitespace-pre-wrap">
								{data ? cloudAttachments.content : message.snippet}
							</pre>
						)}
						{bodyDisplay.quotedContent.map((quotedContent) => (
							<PreviousMessage
								key={`${quotedContent.dateLine}-${quotedContent.content.slice(0, 24)}`}
								message={quotedContent}
							/>
						))}
					</div>
				)}
				{cloudAttachments.attachments.length > 0 && (
					<section className="mt-6 border-t border-neutral-100 pt-4">
						<h3 className="mb-3 text-sm font-semibold text-neutral-900">
							Cloud files ({cloudAttachments.attachments.length})
						</h3>
						<div className="grid gap-2 sm:grid-cols-2">
							{cloudAttachments.attachments.map((attachment) => (
								<a
									key={attachment.id}
									href={attachment.url}
									target="_blank"
									rel="noreferrer"
									className="flex items-center gap-3 rounded-lg border border-neutral-200 p-3 text-left hover:border-primary/25 hover:bg-primary/5"
								>
									<Cloud className="h-5 w-5 shrink-0 text-primary" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-neutral-900">
											{attachment.filename}
										</span>
										<span className="block text-xs text-neutral-500">
											Open from {attachment.provider}
										</span>
									</span>
									<ExternalLink className="h-4 w-4 shrink-0 text-neutral-400" />
								</a>
							))}
						</div>
					</section>
				)}
				{attachments.length > 0 && (
					<section className="mt-6 border-t border-neutral-100 pt-4">
						<h3 className="mb-3 text-sm font-semibold text-neutral-900">
							Attachments ({attachments.length})
						</h3>
						<div className="grid gap-2 sm:grid-cols-2">
							{attachments.map((attachment) => (
								<MessageAttachmentCard
									inspection={!!inspection}
									key={attachment.id}
									attachment={attachment}
									messageId={message.id}
									onPreview={setPreviewAttachment}
								/>
							))}
						</div>
					</section>
				)}
			</div>
			<MessageAttachmentViewer
				inspection={!!inspection}
				attachment={previewAttachment}
				messageId={message.id}
				open={previewAttachment !== null}
				onOpenChange={(open) => {
					if (!open) setPreviewAttachment(null);
				}}
			/>
		</article>
	);
}
