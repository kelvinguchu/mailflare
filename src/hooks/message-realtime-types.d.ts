import type { NewMessageNotification } from "@/lib/realtime/types";

export type NewMessageEvent = NewMessageNotification;

export interface NewMessageToast {
	count: number;
	latest: NewMessageEvent;
}

export interface RealtimeAnnouncement {
	id: string;
	text: string;
}

export interface MessageRealtimeState {
	dismissNotification: () => void;
	notification: NewMessageToast | null;
	announcement: RealtimeAnnouncement | null;
}
