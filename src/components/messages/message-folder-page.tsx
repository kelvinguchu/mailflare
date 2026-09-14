"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { useCompose } from "@/components/compose/compose-context";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { usePageLoading } from "@/components/page-loading";
import { useMessageCounts } from "@/hooks/use-message-counts";
import { useMessages } from "@/hooks/use-messages";
import type { BulkMessageAction } from "@/app/api/messages/bulk/types";
import { setMessageDragData } from "@/lib/messages/drag-utils";
import { cn } from "@/lib/utils";
import { BulkMessageToolbar } from "./bulk-message-toolbar";
import { MessageListRowActions } from "./message-list-row-actions";
import { dispatchMessageCountsDelta, toggleMessageStar } from "./message-list-row-actions-utils";
import { MessageNavigationProgress, useMessageNavigation } from "./message-navigation";
import { MessageRowParty } from "./message-row-party";
import type { MessageFolderPageProps, MessageListRowProps, RowMessageAction } from "./types";
import {
	formatMessageListTimestamp,
	getPageRange,
	getMessageParty,
	getMessagePartyClassName,
	getMessagePreview,
	formatEmailPageTitle,
	getBulkActionScope,
	getInboxUnreadDelta,
	getMailboxAddress,
	getReadValueForAction,
	getUnreadDeltaForAction,
	isInboundConversationRow,
	isMessageRowUnread,
	runBulkMessageAction,
} from "./utils";

const pageSize = 25;
const HIGHLIGHT_CLASS =
	"bg-primary/8 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-500";
const DRAGGABLE_CLASS = "cursor-grab active:cursor-grabbing";

type MessageListRowState = ReturnType<typeof useMessageListRowState>;
type MessageListRowViewProps = Readonly<MessageListRowProps & { row: MessageListRowState }>;

function getCompactRowStateClass(active: boolean, selected: boolean): string {
	if (active) return "border-l-primary bg-primary/8";
	if (selected) return "border-l-transparent bg-neutral-50";
	return "border-l-transparent hover:bg-neutral-50";
}

/** Local read and star state, so a row responds before the list refreshes. */
function useMessageListRowState({
	message,
	config,
	currentAccountName,
}: Pick<MessageListRowProps, "message" | "config" | "currentAccountName">) {
	const [read, setRead] = useState(message.read);
	const [starred, setStarred] = useState(message.starred);
	useEffect(() => setRead(message.read), [message.read]);
	useEffect(() => setStarred(message.starred), [message.starred]);
	const rowMessage = { ...message, read, starred };
	const unread = isMessageRowUnread(rowMessage);
	const inboundRow = isInboundConversationRow(message);
	const href = `${config.hrefPrefix}/${message.id}`;
	const navigation = useMessageNavigation(href, rowMessage);

	function onNavigate(event: MouseEvent<HTMLAnchorElement>) {
		const opensElsewhere = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
		if (unread && !opensElsewhere) {
			setRead(true);
			dispatchMessageCountsDelta({ inboxUnreadDelta: -1 });
			const scope = getBulkActionScope(config.folder);
			void runBulkMessageAction([message.id], "read", false, scope).catch(() => {
				setRead(false);
				dispatchMessageCountsDelta({ inboxUnreadDelta: 1 });
			});
		}
		navigation.onNavigate(event, unread);
	}

	return {
		read,
		setRead,
		starred,
		setStarred,
		rowMessage,
		unread,
		inboundRow,
		draggable: config.folder === "inbox" && inboundRow,
		party: getMessageParty(rowMessage, config.folder, currentAccountName),
		href,
		progress: navigation.progress,
		onNavigate,
	};
}

function MessageListRow(props: Readonly<MessageListRowProps>) {
	const row = useMessageListRowState(props);
	if (props.compact && props.config.folder !== "drafts") {
		return <CompactMessageListRow {...props} row={row} />;
	}
	return <FullMessageListRow {...props} row={row} />;
}

function CompactMessageListRow({
	message,
	config,
	selected,
	active = false,
	highlighted = false,
	onSelectedChange,
	dragMessageIds,
	row,
}: MessageListRowViewProps) {
	return (
		<div
			className={cn(
				"group grid grid-cols-[20px_minmax(0,1fr)] gap-3 border-l-2 px-4 py-3 transition-colors",
				getCompactRowStateClass(active, selected),
				highlighted && HIGHLIGHT_CLASS,
				row.draggable && DRAGGABLE_CLASS,
			)}
			draggable={row.draggable}
			onDragStart={(event) => {
				if (!row.draggable) return;
				setMessageDragData(event.dataTransfer, { messageIds: dragMessageIds });
			}}
		>
			<MessageNavigationProgress progress={row.progress} />
			<Checkbox
				checked={selected}
				onChange={(event) => onSelectedChange(message.id, event.target.checked)}
				className="mt-1 h-4 w-4 rounded border-neutral-300"
				aria-label={`Select message from ${row.party}`}
			/>
			<Link href={row.href} onClick={row.onNavigate} className="min-w-0">
				<span className="flex items-baseline justify-between gap-3">
					<MessageRowParty
						message={row.rowMessage}
						folder={config.folder}
						fallback={row.party}
						className={getMessagePartyClassName(row.rowMessage, config.folder)}
					/>
					<span
						className={cn(
							"shrink-0 text-[11px]",
							row.unread ? "font-semibold text-neutral-800" : "text-neutral-400",
						)}
					>
						{formatMessageListTimestamp(message.createdAt)}
					</span>
				</span>
				<span
					className={cn(
						"mt-1 block truncate text-sm",
						row.unread ? "font-semibold text-neutral-900" : "text-neutral-700",
					)}
				>
					{message.subject ?? "(no subject)"}
				</span>
				<span className="mt-0.5 block truncate text-xs leading-5 text-neutral-500">
					{getMessagePreview(row.rowMessage, config.folder)}
				</span>
			</Link>
		</div>
	);
}

function MessageRowStarCell({
	messageId,
	config,
	row,
}: Readonly<{
	messageId: string;
	config: MessageListRowProps["config"];
	row: MessageListRowState;
}>) {
	const Icon = config.icon;
	if (config.folder !== "inbox" || !row.inboundRow) {
		return <Icon className="h-4 w-4 text-neutral-300" />;
	}
	const label = row.starred ? "Starred" : "Not starred";
	return (
		<Tooltip label={label}>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					void toggleMessageStar(messageId).then((result) => row.setStarred(result.starred));
				}}
				aria-label={label}
			>
				<Icon
					className={cn(
						"h-4 w-4",
						row.starred ? "fill-amber-400 text-amber-400" : "text-neutral-300",
					)}
				/>
			</Button>
		</Tooltip>
	);
}

function FullMessageListRow({
	message,
	config,
	selected,
	active = false,
	highlighted = false,
	onSelectedChange,
	onMessageAction,
	dragMessageIds,
	row,
}: MessageListRowViewProps) {
	const { openDraftComposer } = useCompose();
	const className = cn(
		"group relative grid min-h-12 w-full grid-cols-[24px_32px_minmax(160px,240px)_minmax(0,1fr)_auto] items-center gap-3 px-6 text-left text-sm hover:z-10 hover:bg-[#f2f6fc] hover:shadow-sm",
		(active || selected) && "bg-primary/8",
		highlighted && HIGHLIGHT_CLASS,
		row.draggable && DRAGGABLE_CLASS,
	);
	const checkbox = (
		<Checkbox
			checked={selected}
			onChange={(event) => onSelectedChange(message.id, event.target.checked)}
			className="h-4 w-4 rounded border-neutral-300"
			aria-label="Select message"
		/>
	);
	const content = (
		<>
			<MessageRowStarCell messageId={message.id} config={config} row={row} />
			<MessageRowParty
				message={row.rowMessage}
				folder={config.folder}
				fallback={row.party}
				className={getMessagePartyClassName(row.rowMessage, config.folder)}
			/>
			<span className="truncate text-neutral-700">
				<span className={row.unread ? "font-bold text-neutral-900" : ""}>
					{row.rowMessage.subject ?? "(no subject)"}
				</span>
				<span className="text-neutral-500">
					{" "}
					- {getMessagePreview(row.rowMessage, config.folder)}
				</span>
			</span>
			<time
				dateTime={message.createdAt}
				className={cn(
					"min-w-24 whitespace-nowrap text-right text-xs group-hover:opacity-0",
					row.unread ? "font-semibold text-neutral-800" : "text-neutral-500",
				)}
			>
				{formatMessageListTimestamp(message.createdAt)}
			</time>
		</>
	);

	if (config.folder === "drafts") {
		return (
			<div className={className}>
				{checkbox}
				<button
					type="button"
					className="contents text-left"
					onClick={() => openDraftComposer(message.id)}
				>
					{content}
				</button>
			</div>
		);
	}

	async function runRowAction(action: RowMessageAction) {
		const unreadDelta = getUnreadDeltaForAction(action);
		if (unreadDelta === 0) {
			await onMessageAction(message.id, action);
			return;
		}
		const previousRead = row.read;
		row.setRead(unreadDelta < 0);
		dispatchMessageCountsDelta({ inboxUnreadDelta: unreadDelta });
		try {
			await onMessageAction(message.id, action);
		} catch (error) {
			row.setRead(previousRead);
			dispatchMessageCountsDelta({ inboxUnreadDelta: -unreadDelta });
			throw error;
		}
	}

	const showRowActions =
		(config.folder === "inbox" || config.folder === "snoozed") && row.inboundRow;

	return (
		<div
			className={className}
			draggable={row.draggable}
			onDragStart={(event) => {
				if (!row.draggable) return;
				setMessageDragData(event.dataTransfer, { messageIds: dragMessageIds });
			}}
		>
			<MessageNavigationProgress progress={row.progress} />
			{checkbox}
			<Link href={row.href} onClick={row.onNavigate} className="contents">
				{content}
			</Link>
			{showRowActions && <MessageListRowActions message={row.rowMessage} onAction={runRowAction} />}
		</div>
	);
}

export function MessageFolderPage({
	config,
	compact = false,
	selectedMessageId,
	selection,
}: MessageFolderPageProps) {
	const { selectedMailbox, isLoading: mailboxesLoading } = useSelectedMailbox();
	const { query, debouncedQuery } = useMailSearch();
	const [offset, setOffset] = useState(0);
	const [internalSelectedMessages, setInternalSelectedMessages] = useState<
		Array<{ id: string; read: boolean }>
	>([]);
	const [pendingBulkAction, setPendingBulkAction] = useState(false);
	const [unreadOnly, setUnreadOnly] = useState(false);
	const {
		messages,
		isLoading,
		total,
		limit,
		highlightedMessageIds,
		realtimeListRef,
		updateMessages,
	} = useMessages(
		config.folder,
		selectedMailbox?.id,
		{
			query: debouncedQuery,
			limit: pageSize,
			offset,
			read: unreadOnly ? "unread" : "all",
		},
		!mailboxesLoading,
		config.folderId,
	);
	const { counts } = useMessageCounts(selectedMailbox?.id, !mailboxesLoading);
	usePageLoading(mailboxesLoading || isLoading);
	const headerIcons = config.headerIcons ?? [];
	const hasActiveFilters = !!debouncedQuery.trim();
	const folderCount = config.folderId
		? counts.customFolders[config.folderId]
		: counts.folders[config.folder];
	const titleUnread = folderCount?.unread ?? 0;
	const mailboxAddress = getMailboxAddress(selectedMailbox);
	const currentAccountName = selectedMailbox?.displayName ?? selectedMailbox?.localPart;
	const pageRange = getPageRange(offset, messages.length, total);
	const selectedMessages = selection?.selectedMessages ?? internalSelectedMessages;
	const setSelectedMessages = selection?.setSelectedMessages ?? setInternalSelectedMessages;
	const selectedIds = useMemo(
		() => selectedMessages.map((message) => message.id),
		[selectedMessages],
	);
	const hasUnreadSelection = selectedMessages.some((message) => !message.read);
	const allVisibleSelected =
		messages.length > 0 && messages.every((message) => selectedIds.includes(message.id));

	useEffect(() => {
		setOffset(0);
		setSelectedMessages([]);
	}, [query, selectedMailbox?.id, config.folder, config.folderId, unreadOnly, setSelectedMessages]);

	useEffect(() => {
		setSelectedMessages([]);
	}, [offset, setSelectedMessages]);

	useEffect(() => {
		if (mailboxesLoading) return;
		document.title = formatEmailPageTitle({
			location: config.title,
			unread: titleUnread,
			emailAddress: mailboxAddress,
		});
	}, [config.title, mailboxAddress, mailboxesLoading, titleUnread]);

	function updateSelectedMessage(messageId: string, selected: boolean) {
		const message = messages.find((item) => item.id === messageId);
		if (!message) return;

		setSelectedMessages((current) => {
			if (!selected) return current.filter((item) => item.id !== messageId);
			if (current.some((item) => item.id === messageId)) return current;
			return [...current, { id: message.id, read: message.read }];
		});
	}

	function toggleAllVisible(selected: boolean) {
		const visibleIds = new Set(messages.map((message) => message.id));
		setSelectedMessages((current) => {
			if (!selected) {
				return current.filter((message) => !visibleIds.has(message.id));
			}

			const next = new Map(current.map((message) => [message.id, message]));
			for (const message of messages) {
				next.set(message.id, { id: message.id, read: message.read });
			}
			return Array.from(next.values());
		});
	}

	async function runSelectedAction(action: BulkMessageAction) {
		if (selectedIds.length === 0) return;

		setPendingBulkAction(true);
		const previousMessages = messages;
		const readValue = getReadValueForAction(action);
		const changedMessages =
			readValue === null
				? []
				: messages.filter(
						(message) => selectedIds.includes(message.id) && message.read !== readValue,
					);
		if (readValue !== null) {
			updateMessages((current) =>
				current.map((message) =>
					selectedIds.includes(message.id) ? { ...message, read: readValue } : message,
				),
			);
			setSelectedMessages((current) => current.map((message) => ({ ...message, read: readValue })));
			const inboxUnreadDelta = getInboxUnreadDelta(changedMessages, readValue);
			if (inboxUnreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta });
		}
		try {
			await runBulkMessageAction(selectedIds, action, true, getBulkActionScope(config.folder));
			setSelectedMessages([]);
		} catch (error) {
			if (readValue !== null) {
				updateMessages(previousMessages);
				const inboxUnreadDelta = -getInboxUnreadDelta(changedMessages, readValue);
				if (inboxUnreadDelta) dispatchMessageCountsDelta({ inboxUnreadDelta });
			}
			throw error;
		} finally {
			setPendingBulkAction(false);
		}
	}

	return (
		<div ref={realtimeListRef} className="flex h-full min-h-0 flex-col">
			<div
				className={`flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 ${compact ? "px-4" : "px-6"}`}
			>
				<div className="flex items-center gap-3 w-full">
					<Tooltip label="Select all visible messages">
						<Checkbox
							checked={allVisibleSelected}
							disabled={messages.length === 0}
							onChange={(event) => toggleAllVisible(event.target.checked)}
							className="h-4 w-4 rounded border-neutral-300"
							aria-label="Select all visible messages"
						/>
					</Tooltip>
					{selectedIds.length > 0 && !compact ? (
						<BulkMessageToolbar
							selectedCount={selectedIds.length}
							hasUnreadSelection={hasUnreadSelection}
							onAction={runSelectedAction}
							onClearSelection={() => setSelectedMessages([])}
							pending={pendingBulkAction}
						/>
					) : (
						compact && (
							<>
								{/* <h1 className="truncate text-sm font-semibold text-neutral-900">
									{config.title}
								</h1>
								<Badge variant="secondary">{total}</Badge> */}
							</>
						)
					)}
				</div>
				{(selectedIds.length === 0 || compact) && (
					<div className="flex items-center gap-2 text-neutral-500">
						<span className="text-xs text-neutral-500 whitespace-nowrap">
							{pageRange.start} - {pageRange.end} of {pageRange.total}
						</span>
						<Tooltip label="Previous page">
							<Button
								variant="ghost"
								size="sm"
								disabled={offset === 0 || isLoading}
								onClick={() => setOffset(Math.max(offset - limit, 0))}
								aria-label="Previous page"
							>
								<ChevronLeft className="h-4 w-4" />
							</Button>
						</Tooltip>
						<Tooltip label="Next page">
							<Button
								variant="ghost"
								size="sm"
								disabled={offset + messages.length >= total || isLoading}
								onClick={() => setOffset(offset + limit)}
								aria-label="Next page"
							>
								<ChevronRight className="h-4 w-4" />
							</Button>
						</Tooltip>
						{config.folder === "inbox" && (
							<Tooltip label={unreadOnly ? "Showing unread emails" : "Show unread emails only"}>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-label="Show unread emails only"
									aria-pressed={unreadOnly}
									onClick={() => setUnreadOnly((current) => !current)}
									className={
										unreadOnly ? "bg-primary/12 text-primary hover:bg-primary/15" : undefined
									}
								>
									<ListFilter className="h-4 w-4" />
								</Button>
							</Tooltip>
						)}
						{!compact &&
							headerIcons.map((Icon) => <Icon key={Icon.displayName} className="h-4 w-4" />)}
					</div>
				)}
			</div>

			<div className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-gutter-stable">
				{messages.map((message) => (
					<MessageListRow
						key={message.id}
						message={message}
						config={config}
						selected={selectedIds.includes(message.id)}
						active={message.id === selectedMessageId}
						compact={compact}
						currentAccountName={currentAccountName}
						highlighted={highlightedMessageIds.has(message.id)}
						onSelectedChange={updateSelectedMessage}
						onMessageAction={(messageId, action) =>
							runBulkMessageAction(
								[messageId],
								action,
								action !== "read" && action !== "unread",
								getBulkActionScope(config.folder),
							)
						}
						dragMessageIds={selectedIds.includes(message.id) ? selectedIds : [message.id]}
					/>
				))}
				{!isLoading && messages.length === 0 && (
					<p className="px-6 py-4 text-sm text-neutral-500">
						{hasActiveFilters ? "No messages match these filters" : config.emptyText}
					</p>
				)}
			</div>
		</div>
	);
}
