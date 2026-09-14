import { useEffect, useState } from "react";
import type { MessageCounts, MessageCountsDelta } from "./types";
import type { NewMessageEvent } from "./message-realtime-types";
import {
	applyRealtimeMessageToCounts,
	MESSAGE_REALTIME_EVENT,
	MESSAGE_RECONCILE_EVENT,
} from "./message-realtime-utils";
import { clearMessageCountsCache, fetchMessageCounts } from "./utils";

const emptyCounts: MessageCounts = {
	folders: {
		inbox: { total: 0, unread: 0 },
		starred: { total: 0, unread: 0 },
		snoozed: { total: 0, unread: 0 },
		sent: { total: 0, unread: 0 },
		drafts: { total: 0, unread: 0 },
		archived: { total: 0, unread: 0 },
		spam: { total: 0, unread: 0 },
		trash: { total: 0, unread: 0 },
	},
	customFolders: {},
	mailboxes: [],
};

export function useMessageCounts(mailboxId?: string | null, enabled = true) {
	const [counts, setCounts] = useState<MessageCounts>(emptyCounts);
	const [isLoading, setIsLoading] = useState(enabled);

	useEffect(() => {
		if (!enabled) {
			setIsLoading(false);
			return;
		}

		let cancelled = false;

		async function loadCounts(force = false, showLoading = false) {
			if (showLoading) setIsLoading(true);
			try {
				const nextCounts = await fetchMessageCounts(mailboxId, force);
				if (!cancelled) setCounts(nextCounts ?? emptyCounts);
			} finally {
				if (!cancelled) setIsLoading(false);
			}
		}

		void loadCounts(false, true);
		function onMessagesChanged() {
			clearMessageCountsCache();
			void loadCounts(true);
		}
		function onRealtimeMessage(receivedEvent: Event) {
			const event = (receivedEvent as CustomEvent<NewMessageEvent>).detail;
			if (!event?.message) return;
			setCounts((current) => applyRealtimeMessageToCounts(current, event.message, mailboxId));
		}
		function onMessagesReconcile() {
			void loadCounts();
		}
		function onMessageCountsDelta(event: Event) {
			const detail = (event as CustomEvent<MessageCountsDelta>).detail;
			const inboxUnreadDelta = detail?.inboxUnreadDelta;
			if (!inboxUnreadDelta) return;
			setCounts((current) => ({
				...current,
				folders: {
					...current.folders,
					inbox: {
						...current.folders.inbox,
						unread: Math.max(0, current.folders.inbox.unread + inboxUnreadDelta),
					},
				},
			}));
		}
		window.addEventListener("mailflare:messages-changed", onMessagesChanged);
		window.addEventListener("mailflare:message-counts-changed", onMessagesChanged);
		window.addEventListener("mailflare:message-counts-delta", onMessageCountsDelta);
		window.addEventListener(MESSAGE_REALTIME_EVENT, onRealtimeMessage);
		window.addEventListener(MESSAGE_RECONCILE_EVENT, onMessagesReconcile);
		const refreshInterval = window.setInterval(() => void loadCounts(true), 15_000);

		return () => {
			cancelled = true;
			window.removeEventListener("mailflare:messages-changed", onMessagesChanged);
			window.removeEventListener("mailflare:message-counts-changed", onMessagesChanged);
			window.removeEventListener("mailflare:message-counts-delta", onMessageCountsDelta);
			window.removeEventListener(MESSAGE_REALTIME_EVENT, onRealtimeMessage);
			window.removeEventListener(MESSAGE_RECONCILE_EVENT, onMessagesReconcile);
			window.clearInterval(refreshInterval);
		};
	}, [enabled, mailboxId]);

	return { counts, isLoading };
}
