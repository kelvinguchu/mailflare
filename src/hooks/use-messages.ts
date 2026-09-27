import { useCallback, useEffect, useRef, useState } from "react";
import type { SetStateAction } from "react";
import type { Message, MessageFilterOptions, MessageFolder } from "./types";
import type { NewMessageEvent } from "./message-realtime-types";
import {
	doesRealtimeMessageMatch,
	MESSAGE_REALTIME_EVENT,
	MESSAGE_RECONCILE_EVENT,
	REALTIME_HIGHLIGHT_MS,
} from "./message-realtime-utils";
import {
	clearMessageCountsCache,
	clearMessageListCache,
	fetchMessageList,
	getMessageQueryParams,
	MESSAGE_POLL_INTERVAL_MS,
} from "./utils";
import { getEmailAddress, getEmailDisplayName } from "@/lib/email/address";

export function useMessages(
	folder: MessageFolder,
	mailboxId?: string | null,
	filters?: MessageFilterOptions,
	enabled = true,
	folderId?: string | null,
) {
	const [messages, setMessages] = useState<Message[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [total, setTotal] = useState(0);
	const [limit, setLimit] = useState(filters?.limit ?? 25);
	const [offset, setOffset] = useState(filters?.offset ?? 0);
	const [nextCursor, setNextCursor] = useState<string>();
	const [highlightedMessageIds, setHighlightedMessageIds] = useState<Set<string>>(new Set());
	const messageIdsRef = useRef<Set<string>>(new Set());
	const threadMessageIdsRef = useRef<Map<string, string>>(new Map());
	const realtimeListRef = useRef<HTMLDivElement>(null);
	const filterLimit = filters?.limit;
	const filterOffset = filters?.offset;
	const filterQuery = filters?.query;
	const filterRead = filters?.read;
	const filterTitle = filters?.title;
	const filterPagination = filters?.pagination;
	const filterCursor = filters?.cursor;

	const unreadCount = messages.filter((m) => m.direction === "inbound" && !m.read).length;
	const updateMessages = useCallback((update: SetStateAction<Message[]>) => {
		setMessages((current) => {
			const next = typeof update === "function" ? update(current) : update;
			messageIdsRef.current = new Set(next.map((message) => message.id));
			threadMessageIdsRef.current = new Map(
				next.flatMap((message) =>
					message.thread ? [[message.thread.id, message.id] as const] : [],
				),
			);
			return next;
		});
	}, []);

	useEffect(() => {
		if (!enabled) return;
		let cancelled = false;
		let activeRequestController: AbortController | null = null;
		const highlightTimers = new Map<string, number>();
		async function loadMessages(force = false, showLoading = false) {
			activeRequestController?.abort();
			const requestController = new AbortController();
			activeRequestController = requestController;
			if (showLoading) setIsLoading(true);
			try {
				const params = getMessageQueryParams(
					folder,
					mailboxId,
					{
						limit: filterLimit,
						offset: filterOffset,
						query: filterQuery,
						read: filterRead,
						title: filterTitle,
						pagination: filterPagination,
						cursor: filterCursor,
					},
					folderId,
				);
				const data = await fetchMessageList(params, force, requestController.signal);
				if (!cancelled && !requestController.signal.aborted) {
					updateMessages(data.messages ?? []);
					if (data.total !== undefined) setTotal(data.total);
					setLimit(data.limit ?? filterLimit ?? 25);
					setOffset(data.offset ?? filterOffset ?? 0);
					setNextCursor(data.nextCursor);
				}
			} catch (error) {
				if (!cancelled && !requestController.signal.aborted) throw error;
			} finally {
				if (activeRequestController === requestController) {
					activeRequestController = null;
				}
				if (!cancelled && !requestController.signal.aborted) setIsLoading(false);
			}
		}

		void loadMessages(false, true);
		function onMessagesChanged() {
			clearMessageListCache();
			clearMessageCountsCache();
			void loadMessages(true);
		}
		function onRealtimeMessage(receivedEvent: Event) {
			const event = (receivedEvent as CustomEvent<NewMessageEvent>).detail;
			if (!event?.message) return;
			if (filterCursor) return;
			const params = getMessageQueryParams(
				folder,
				mailboxId,
				{
					limit: filterLimit,
					offset: filterOffset,
					query: filterQuery,
					read: filterRead,
					title: filterTitle,
					pagination: filterPagination,
					cursor: filterCursor,
				},
				folderId,
			);
			if (!doesRealtimeMessageMatch(event.message, params, filterOffset ?? 0)) return;
			if (
				document.visibilityState === "visible" &&
				(realtimeListRef.current?.getClientRects().length ?? 0) > 0
			) {
				receivedEvent.preventDefault();
			}

			activeRequestController?.abort();
			const alreadyPresent = messageIdsRef.current.has(event.message.id);
			const threadView = params.get("view") === "threads";
			const existingThreadMessageId = event.message.threadId
				? threadMessageIdsRef.current.get(event.message.threadId)
				: undefined;
			updateMessages((current) => {
				if (alreadyPresent) {
					return current.map((message) =>
						message.id === event.message.id ? { ...message, ...event.message } : message,
					);
				}
				if (threadView && event.message.threadId) {
					const existing = existingThreadMessageId
						? current.find((message) => message.id === existingThreadMessageId)
						: undefined;
					const address = getEmailAddress(event.message.fromAddr);
					const participants = existing?.thread?.participants
						? existing.thread.participants.map((participant) => ({ ...participant }))
						: [];
					const participant = participants.find(
						(item) => item.address.toLowerCase() === address.toLowerCase(),
					);
					if (participant) participant.unread = true;
					else {
						participants.push({
							name: event.message.fromContactName ?? getEmailDisplayName(event.message.fromAddr),
							address,
							isMe: false,
							unread: true,
						});
					}
					const next = {
						...event.message,
						starred: event.message.starred || existing?.starred || false,
						thread: {
							id: event.message.threadId,
							messageCount: (existing?.thread?.messageCount ?? 0) + 1,
							unreadCount: (existing?.thread?.unreadCount ?? 0) + 1,
							hasAttachments: existing?.thread?.hasAttachments ?? false,
							lastMessageAt: event.message.createdAt,
							participants,
						},
					};
					return [
						next,
						...current.filter((message) => message.id !== existingThreadMessageId),
					].slice(0, filterLimit ?? 25);
				}
				return [event.message, ...current].slice(0, filterLimit ?? 25);
			});
			if (!alreadyPresent && !existingThreadMessageId) setTotal((current) => current + 1);
			if (filterPagination === "cursor") {
				setNextCursor(undefined);
				void loadMessages(true);
			}

			setHighlightedMessageIds((current) => new Set(current).add(event.message.id));
			const existingTimer = highlightTimers.get(event.message.id);
			if (existingTimer) window.clearTimeout(existingTimer);
			highlightTimers.set(
				event.message.id,
				window.setTimeout(() => {
					highlightTimers.delete(event.message.id);
					setHighlightedMessageIds((current) => {
						const next = new Set(current);
						next.delete(event.message.id);
						return next;
					});
				}, REALTIME_HIGHLIGHT_MS),
			);
		}
		function onMessagesReconcile() {
			void loadMessages();
		}
		window.addEventListener("mailflare:messages-changed", onMessagesChanged);
		window.addEventListener(MESSAGE_REALTIME_EVENT, onRealtimeMessage);
		window.addEventListener(MESSAGE_RECONCILE_EVENT, onMessagesReconcile);
		const refreshInterval = window.setInterval(
			() => void loadMessages(true),
			MESSAGE_POLL_INTERVAL_MS,
		);

		return () => {
			cancelled = true;
			activeRequestController?.abort();
			for (const timer of highlightTimers.values()) window.clearTimeout(timer);
			window.removeEventListener("mailflare:messages-changed", onMessagesChanged);
			window.removeEventListener(MESSAGE_REALTIME_EVENT, onRealtimeMessage);
			window.removeEventListener(MESSAGE_RECONCILE_EVENT, onMessagesReconcile);
			window.clearInterval(refreshInterval);
		};
	}, [
		enabled,
		filterLimit,
		filterCursor,
		filterOffset,
		filterPagination,
		filterQuery,
		filterRead,
		filterTitle,
		folder,
		folderId,
		mailboxId,
		updateMessages,
	]);

	return {
		messages,
		unreadCount,
		isLoading,
		total,
		limit,
		offset,
		nextCursor,
		highlightedMessageIds,
		realtimeListRef,
		updateMessages,
	};
}
