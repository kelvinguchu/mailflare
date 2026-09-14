import { useCallback, useEffect, useState } from "react";
import { AUTH_SESSION_CHANGED_EVENT, authFetch } from "@/lib/auth/client";
import type { AuthSessionChangedDetail } from "@/lib/auth/client-types";
import { toast } from "@/components/ui/toast";
import type { MessageRealtimeState, NewMessageEvent } from "./message-realtime-types";
import {
	dispatchMessageReconciliation,
	dispatchRealtimeTaskChange,
	dispatchRealtimeMessage,
	getRealtimeAnnouncement,
	getRealtimeWebSocketUrl,
	getReconnectDelay,
	getTaskChangeAnnouncement,
	getTaskChangeToast,
	openTaskFromNotification,
	parseRealtimeEvent,
	REALTIME_FALLBACK_INTERVAL_MS,
	REALTIME_HEARTBEAT_INTERVAL_MS,
	REALTIME_NOTIFICATION_BATCH_MS,
	REALTIME_RECONCILE_BATCH_MS,
	REALTIME_RECONNECT_JITTER_MS,
	showBrowserNewMessageNotification,
} from "./message-realtime-utils";
import { clearMessageCountsCache, clearMessageListCache } from "./utils";

const MAX_SEEN_REALTIME_EVENTS = 500;
const SEEN_REALTIME_EVENT_TTL_MS = 10 * 60_000;

type PendingNotification = {
	displayedInList: boolean;
	event: NewMessageEvent;
};

export function useMessagePolling(): MessageRealtimeState {
	const [notification, setNotification] = useState<MessageRealtimeState["notification"]>(null);
	const [announcement, setAnnouncement] = useState<MessageRealtimeState["announcement"]>(null);
	const dismissNotification = useCallback(() => setNotification(null), []);

	useEffect(() => {
		let socket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		let heartbeatTimer: number | null = null;
		let fallbackTimer: number | null = null;
		let notificationBatchTimer: number | null = null;
		let reconciliationTimer: number | null = null;
		let pendingNotifications: PendingNotification[] = [];
		const seenEventKeys = new Map<string, number>();
		let reconnectAttempt = 0;
		let stopped = false;
		let sessionActive = false;

		function reconcileMessages() {
			clearMessageListCache();
			clearMessageCountsCache();
			dispatchMessageReconciliation();
		}

		function stopConnectionTimers() {
			if (reconnectTimer) window.clearTimeout(reconnectTimer);
			if (heartbeatTimer) window.clearInterval(heartbeatTimer);
			if (fallbackTimer) window.clearInterval(fallbackTimer);
			reconnectTimer = null;
			heartbeatTimer = null;
			fallbackTimer = null;
		}

		function stopBatchTimers() {
			if (notificationBatchTimer) window.clearTimeout(notificationBatchTimer);
			if (reconciliationTimer) window.clearTimeout(reconciliationTimer);
			notificationBatchTimer = null;
			reconciliationTimer = null;
		}

		function startFallbackRefresh() {
			if (fallbackTimer) return;
			fallbackTimer = window.setInterval(reconcileMessages, REALTIME_FALLBACK_INTERVAL_MS);
		}

		function scheduleReconciliation(delay = REALTIME_RECONCILE_BATCH_MS) {
			if (reconciliationTimer) window.clearTimeout(reconciliationTimer);
			reconciliationTimer = window.setTimeout(() => {
				reconciliationTimer = null;
				reconcileMessages();
			}, delay);
		}

		function hasSeenEvent(eventId: string, messageId?: string): boolean {
			const now = Date.now();
			const eventKey = `event:${eventId}`;
			const messageKey = messageId ? `message:${messageId}` : null;
			const seenAt =
				seenEventKeys.get(eventKey) ?? (messageKey ? seenEventKeys.get(messageKey) : undefined);
			if (seenAt !== undefined && now - seenAt < SEEN_REALTIME_EVENT_TTL_MS) return true;

			seenEventKeys.set(eventKey, now);
			if (messageKey) seenEventKeys.set(messageKey, now);
			for (const [key, timestamp] of seenEventKeys) {
				if (
					seenEventKeys.size <= MAX_SEEN_REALTIME_EVENTS * 2 &&
					now - timestamp < SEEN_REALTIME_EVENT_TTL_MS
				) {
					break;
				}
				seenEventKeys.delete(key);
			}
			return false;
		}

		function flushNotificationBatch() {
			notificationBatchTimer = null;
			const batch = pendingNotifications;
			pendingNotifications = [];
			const events = batch.map((item) => item.event);
			const latest = events.at(-1);
			if (!latest) return;

			setAnnouncement({ id: latest.eventId, text: getRealtimeAnnouncement(events) });
			showBrowserNewMessageNotification(events);

			const visualEvents = batch
				.filter((item) => !item.displayedInList || document.visibilityState !== "visible")
				.map((item) => item.event);
			const latestVisualEvent = visualEvents.at(-1);
			if (!latestVisualEvent) return;
			setNotification((current) => ({
				latest: latestVisualEvent,
				count: (current?.count ?? 0) + visualEvents.length,
			}));
		}

		function queueNotification(event: NewMessageEvent, displayedInList: boolean) {
			pendingNotifications.push({ event, displayedInList });
			if (notificationBatchTimer) return;
			notificationBatchTimer = window.setTimeout(
				flushNotificationBatch,
				REALTIME_NOTIFICATION_BATCH_MS,
			);
		}

		async function scheduleReconnect() {
			if (stopped || !sessionActive) return;
			try {
				const response = await authFetch("/api/auth/me", {
					cache: "no-store",
					redirectOnUnauthorized: false,
				});
				if (!response.ok) {
					sessionActive = false;
					if (fallbackTimer) window.clearInterval(fallbackTimer);
					fallbackTimer = null;
					return;
				}
			} catch {
				// A transient network failure should use the normal reconnect backoff.
			}
			if (stopped || !sessionActive) return;
			const delay = getReconnectDelay(reconnectAttempt);
			reconnectAttempt += 1;
			reconnectTimer = window.setTimeout(connect, delay);
		}

		function connect() {
			if (stopped || !sessionActive) return;
			if (reconnectTimer) window.clearTimeout(reconnectTimer);
			reconnectTimer = null;
			if (heartbeatTimer) window.clearInterval(heartbeatTimer);
			heartbeatTimer = null;

			socket = new WebSocket(getRealtimeWebSocketUrl());
			socket.onopen = () => {
				reconnectAttempt = 0;
				if (fallbackTimer) window.clearInterval(fallbackTimer);
				fallbackTimer = null;
				scheduleReconciliation(Math.floor(Math.random() * REALTIME_RECONNECT_JITTER_MS));
				heartbeatTimer = window.setInterval(() => {
					if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
				}, REALTIME_HEARTBEAT_INTERVAL_MS);
			};
			socket.onmessage = (message) => {
				if (message.data === "pong" || typeof message.data !== "string") return;
				const event = parseRealtimeEvent(message.data);
				if (!event) {
					// A rolling deployment may briefly pair a newer client with an older event shape.
					scheduleReconciliation();
					return;
				}
				if (event.type === "task_changed") {
					if (hasSeenEvent(event.eventId)) return;
					dispatchRealtimeTaskChange(event);
					setAnnouncement({ id: event.eventId, text: getTaskChangeAnnouncement(event) });
					const taskId = event.task.id;
					toast.add({
						...getTaskChangeToast(event),
						type: "info",
						actionProps:
							event.task.action === "deleted"
								? undefined
								: { children: "Open", onClick: () => openTaskFromNotification(taskId) },
					});
					return;
				}
				if (hasSeenEvent(event.eventId, event.message.id)) return;
				const displayedInList = dispatchRealtimeMessage(event);
				scheduleReconciliation();
				queueNotification(event, displayedInList);
			};
			socket.onerror = () => socket?.close();
			socket.onclose = () => {
				socket = null;
				if (heartbeatTimer) window.clearInterval(heartbeatTimer);
				heartbeatTimer = null;
				startFallbackRefresh();
				void scheduleReconnect();
			};
		}

		function restartForSessionChange(event: Event) {
			sessionActive = (event as CustomEvent<AuthSessionChangedDetail>).detail.authenticated;
			if (socket) {
				socket.onclose = null;
				socket.close(1000, "Session changed");
				socket = null;
			}
			stopConnectionTimers();
			stopBatchTimers();
			pendingNotifications = [];
			seenEventKeys.clear();
			reconnectAttempt = 0;
			setNotification(null);
			setAnnouncement(null);
			if (sessionActive) connect();
		}

		async function connectForExistingSession() {
			try {
				const response = await authFetch("/api/auth/me", {
					cache: "no-store",
					redirectOnUnauthorized: false,
				});
				if (stopped || !response.ok) return;
				sessionActive = true;
				connect();
			} catch {
				// Public pages and temporary network failures do not need realtime polling.
			}
		}

		window.addEventListener(AUTH_SESSION_CHANGED_EVENT, restartForSessionChange);
		void connectForExistingSession();

		return () => {
			stopped = true;
			window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, restartForSessionChange);
			stopConnectionTimers();
			stopBatchTimers();
			if (socket) {
				socket.onclose = null;
				socket.close(1000, "Client closed");
			}
		};
	}, []);

	useEffect(() => {
		if (!notification) return;
		const timer = window.setTimeout(() => setNotification(null), 8_000);
		return () => window.clearTimeout(timer);
	}, [notification]);

	return { notification, announcement, dismissNotification };
}
