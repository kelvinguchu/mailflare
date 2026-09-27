"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
	ChevronLeft,
	ChevronRight,
	ChevronsDownUp,
	ChevronsUpDown,
	Forward,
	Reply,
} from "lucide-react";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { MessageActions } from "@/components/message-actions/message-actions";
import { runBulkMessageAction } from "@/components/messages/utils";
import { MessageDetailSkeleton } from "@/components/page-skeletons";
import { useReadingPosition, type ReadingPosition } from "@/components/messages/reading-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { MessageDetailResponse } from "@/app/(dashboard)/inbox/[messageId]/types";
import { getCachedMessageDetailForDisplay } from "@/app/(dashboard)/inbox/[messageId]/utils";
import type { Message, MessageThread } from "@/hooks/types";
import { markReadInMessageListCache } from "@/hooks/utils";
import { CollapsedConversationMessage, ExpandedConversationMessage } from "./conversation-message";
import {
	buildConversationItems,
	fetchMessageThread,
	getInitialExpandedIds,
	getMessageFolderLabel,
	isUnreadMessage,
} from "./conversation-utils";
import { InlineReply } from "./inline-reply";
import type { ReplyMode } from "./types";
import { MESSAGE_REALTIME_EVENT } from "@/hooks/message-realtime-utils";

type ReplyState = { mode: ReplyMode; target: Message; detail: MessageDetailResponse | null };

export function ConversationView({ messageId }: Readonly<{ messageId: string }>) {
	const { selectedMailbox } = useSelectedMailbox();
	const [thread, setThread] = useState<MessageThread | null>(null);
	const [loading, setLoading] = useState(true);
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const [showAll, setShowAll] = useState(false);
	const [reply, setReply] = useState<ReplyState | null>(null);
	const markedRead = useRef(new Set<string>());
	const knownMessageIds = useRef(new Set<string>());
	const scrolledThreadId = useRef<string | null>(null);
	const replyRef = useRef<HTMLDivElement>(null);

	const applyThread = useCallback(
		(next: MessageThread | null) => {
			setThread(next);
			if (!next) return;
			const isNewThread = knownMessageIds.current.size === 0;
			if (isNewThread) {
				setExpandedIds(getInitialExpandedIds(next.messages, messageId));
			} else {
				// Messages that arrive while reading, such as your own sent reply, open expanded.
				const arrived = next.messages.filter((message) => !knownMessageIds.current.has(message.id));
				if (arrived.length) {
					setExpandedIds(
						(current) => new Set([...current, ...arrived.map((message) => message.id)]),
					);
				}
			}
			knownMessageIds.current = new Set(next.messages.map((message) => message.id));
		},
		[messageId],
	);

	useEffect(() => {
		let cancelled = false;
		knownMessageIds.current = new Set();
		markedRead.current = new Set();
		setShowAll(false);
		setReply(null);
		setLoading(true);
		void fetchMessageThread(messageId)
			.then((next) => {
				if (!cancelled) applyThread(next);
			})
			.catch(() => {
				if (!cancelled) setThread(null);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		function onMessagesChanged() {
			void fetchMessageThread(messageId)
				.then((next) => {
					if (!cancelled && next) applyThread(next);
				})
				.catch(() => undefined);
		}
		window.addEventListener("mailflare:messages-changed", onMessagesChanged);
		window.addEventListener(MESSAGE_REALTIME_EVENT, onMessagesChanged);
		return () => {
			cancelled = true;
			window.removeEventListener("mailflare:messages-changed", onMessagesChanged);
			window.removeEventListener(MESSAGE_REALTIME_EVENT, onMessagesChanged);
		};
	}, [applyThread, messageId]);

	const messages = useMemo(() => thread?.messages ?? [], [thread]);
	const threadId = thread?.id;
	const reading = useReadingPosition(
		useMemo(() => [messageId, ...messages.map((message) => message.id)], [messageId, messages]),
	);

	// Opening a conversation reads its unread messages, each only once.
	useEffect(() => {
		const unreadIds = messages
			.filter((message) => isUnreadMessage(message) && !markedRead.current.has(message.id))
			.map((message) => message.id);
		if (unreadIds.length === 0) return;
		for (const id of unreadIds) markedRead.current.add(id);
		markReadInMessageListCache({
			messageIds: unreadIds,
			threadIds: threadId ? [threadId] : [],
		});
		void runBulkMessageAction(unreadIds, "read").catch(() => {
			for (const id of unreadIds) markedRead.current.delete(id);
		});
	}, [messages, threadId]);

	// Long conversations open at the first unread message, or the newest one.
	useEffect(() => {
		if (!thread || messages.length < 2 || scrolledThreadId.current === thread.id) return;
		scrolledThreadId.current = thread.id;
		const target = messages.find(isUnreadMessage) ?? messages.at(-1);
		if (!target) return;
		requestAnimationFrame(() =>
			document
				.getElementById(`conversation-message-${target.id}`)
				?.scrollIntoView({ block: "start" }),
		);
	}, [messages, thread]);

	useEffect(() => {
		if (reply) replyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [reply]);

	if (loading && !thread) return <MessageDetailSkeleton />;
	if (!thread || messages.length === 0) {
		return <p className="px-6 py-4 text-sm text-neutral-500">Message not found</p>;
	}

	const currentAccountName = selectedMailbox?.displayName ?? selectedMailbox?.localPart;
	const focusMessage =
		messages.find((message) => message.id === messageId) ?? messages[messages.length - 1];
	const latest = messages[messages.length - 1];
	const focusDetail = getCachedMessageDetailForDisplay(focusMessage.id);
	const items = buildConversationItems(messages, expandedIds, showAll);
	const allExpanded = messages.every((message) => expandedIds.has(message.id));
	const folderLabel = getMessageFolderLabel(focusMessage);

	const openReply = (mode: ReplyMode, target: Message, detail: MessageDetailResponse | null) =>
		setReply({ mode, target, detail });

	return (
		<div className="h-full overflow-y-auto overscroll-contain scrollbar-gutter-stable">
			<div className="sticky top-0 z-10 flex h-12 items-center gap-2 bg-white px-2 sm:px-4">
				<MessageActions
					messageId={focusMessage.id}
					mailboxId={focusMessage.mailboxId}
					senderAddress={focusMessage.fromAddr}
					direction={focusMessage.direction}
					status={focusMessage.status}
					read={messages.every((message) => !isUnreadMessage(message))}
					unsubscribeUrl={focusDetail?.unsubscribeUrl}
					backHref={reading?.backHref}
				/>
				<div className="flex-1" />
				{reading?.position && <ReadingPager reading={reading} />}
			</div>

			<div className="pb-12">
				<div className="flex items-start gap-3 py-4 pr-4 pl-4 sm:pr-6 sm:pl-[76px]">
					<h1 className="min-w-0 flex-1 text-[22px] leading-snug text-neutral-900">
						{thread.subject ?? focusMessage.subject ?? "(no subject)"}
						{folderLabel && (
							<span className="ml-2 inline-flex translate-y-[-3px] items-center rounded bg-neutral-100 px-1.5 py-0.5 align-middle text-xs font-medium text-neutral-600">
								{folderLabel}
							</span>
						)}
					</h1>
					{messages.length > 1 && (
						<Tooltip label={allExpanded ? "Collapse all" : "Expand all"}>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="shrink-0 rounded-full text-neutral-600"
								aria-label={
									allExpanded ? "Collapse all messages" : `Expand all ${messages.length} messages`
								}
								onClick={() => {
									if (allExpanded) {
										setExpandedIds(new Set([latest.id]));
										setShowAll(false);
									} else {
										setExpandedIds(new Set(messages.map((message) => message.id)));
										setShowAll(true);
									}
								}}
							>
								{allExpanded ? (
									<ChevronsDownUp aria-hidden="true" className="size-4" />
								) : (
									<ChevronsUpDown aria-hidden="true" className="size-4" />
								)}
							</Button>
						</Tooltip>
					)}
				</div>

				<ol className="divide-y divide-neutral-100">
					{items.map((item) =>
						item.kind === "hidden" ? (
							<li key={`hidden-${item.messageIds[0]}`} className="relative py-3">
								<div
									className="absolute inset-x-0 top-1/2 border-t border-neutral-200"
									aria-hidden="true"
								/>
								<button
									type="button"
									onClick={() => setShowAll(true)}
									className="relative ml-4 flex size-10 items-center justify-center rounded-full border border-neutral-200 bg-white text-xs font-medium text-neutral-700 hover:bg-neutral-50 sm:ml-6"
									aria-label={`Show ${item.count} older messages`}
									title={`${item.count} older messages`}
								>
									{item.count}
								</button>
							</li>
						) : (
							<li
								key={item.message.id}
								id={`conversation-message-${item.message.id}`}
								className="scroll-mt-16"
							>
								{item.expanded ? (
									<ExpandedConversationMessage
										message={item.message}
										currentAccountName={currentAccountName}
										collapsible={messages.length > 1 && item.message.id !== latest.id}
										onCollapse={() =>
											setExpandedIds((current) => {
												const next = new Set(current);
												next.delete(item.message.id);
												return next;
											})
										}
										onReply={(message, detail) => openReply("reply", message, detail)}
										onForward={(message, detail) => openReply("forward", message, detail)}
									/>
								) : (
									<CollapsedConversationMessage
										message={item.message}
										onExpand={() =>
											setExpandedIds((current) => new Set([...current, item.message.id]))
										}
									/>
								)}
							</li>
						),
					)}
				</ol>

				<div ref={replyRef} className={cn("px-4 pt-4 sm:pr-6", reply ? "sm:pl-6" : "sm:pl-[76px]")}>
					{reply ? (
						<InlineReply
							key={`${reply.mode}-${reply.target.id}`}
							mode={reply.mode}
							target={reply.target}
							subject={thread.subject ?? reply.target.subject}
							detail={reply.detail}
							onClose={() => setReply(null)}
						/>
					) : (
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								className="rounded-full px-5"
								onClick={() =>
									openReply("reply", latest, getCachedMessageDetailForDisplay(latest.id) ?? null)
								}
							>
								<Reply />
								Reply
							</Button>
							<Button
								type="button"
								variant="outline"
								className="rounded-full px-5"
								onClick={() =>
									openReply("forward", latest, getCachedMessageDetailForDisplay(latest.id) ?? null)
								}
							>
								<Forward />
								Forward
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function ReadingPager({ reading }: Readonly<{ reading: ReadingPosition }>) {
	const link = (href: string | null, label: string, icon: React.ReactNode) =>
		href ? (
			<Tooltip label={label}>
				<Link
					href={href}
					aria-label={label}
					className={cn(
						buttonVariants({ variant: "ghost", size: "icon-sm" }),
						"rounded-full text-neutral-600",
					)}
				>
					{icon}
				</Link>
			</Tooltip>
		) : (
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				disabled
				aria-label={label}
				className="rounded-full"
			>
				{icon}
			</Button>
		);

	return (
		<div className="flex shrink-0 items-center gap-1 text-neutral-600">
			<span className="mr-1 hidden text-xs whitespace-nowrap sm:inline">
				{reading.position?.toLocaleString()} of {reading.total.toLocaleString()}
			</span>
			{link(reading.previousHref, "Newer", <ChevronLeft className="size-4" />)}
			{link(reading.nextHref, "Older", <ChevronRight className="size-4" />)}
		</div>
	);
}
