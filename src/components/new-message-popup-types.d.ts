import type { NewMessageToast } from "@/hooks/message-realtime-types";

export interface NewMessagePopupProps {
	notification: NewMessageToast;
	onDismiss: () => void;
}
