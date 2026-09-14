import type { Message } from "@/hooks/types";
import { authFetch } from "@/lib/auth/client";
import { getEmailDisplayName } from "@/lib/email/address";
import dayjs from "dayjs";
import type { MailboxOption } from "@/components/mailbox-provider";
import type { EmailPageTitleInput } from "./types";
import type { MessageFolderConfig } from "./types";
import type { PageRange } from "./types";
import type { BulkMessageScope } from "@/app/api/messages/bulk/types";

export function getMessageParty(
	message: Message,
	folder: MessageFolderConfig["folder"],
	currentAccountName?: string,
) {
	if (folder === "drafts") return "Draft";
	if (folder === "sent")
		return (
			message.toContactName ??
			(message.toAddr ? getEmailDisplayName(message.toAddr) : "No recipient")
		);
	if (message.direction === "outbound" && currentAccountName) return currentAccountName;
	return (
		message.fromContactName ??
		(message.fromAddr ? getEmailDisplayName(message.fromAddr) : "Unknown sender")
	);
}

/**
 * A conversation row's `read` reflects the whole thread; a single-message row is unread
 * only for received mail.
 */
export function isMessageRowUnread(message: Message): boolean {
	if (message.thread) return !message.read;
	return message.direction === "inbound" && !message.read;
}

export function getMessagePartyClassName(message: Message, folder: MessageFolderConfig["folder"]) {
	if (folder === "drafts") return "truncate font-semibold text-red-600";

	const unread = isMessageRowUnread(message);
	return `truncate ${unread ? "font-bold text-neutral-900" : "text-neutral-800"}`;
}

/** Received mail, or a conversation that contains it, supports stars, row actions, and dragging. */
export function isInboundConversationRow(message: Message): boolean {
	return (
		message.direction === "inbound" || Boolean(message.thread?.participants.some((p) => !p.isMe))
	);
}

export function getMessagePreview(message: Message, folder: MessageFolderConfig["folder"]) {
	if (folder === "drafts") return message.snippet || message.toAddr || "No content";
	return message.snippet || "No preview";
}

export function formatMessageListTimestamp(createdAt: string): string {
	const date = dayjs(createdAt);
	if (date.isSame(dayjs(), "day")) return date.format("hh:mm A");
	if (date.isSame(dayjs(), "year")) return date.format("MMM DD");
	return date.format("MMM DD, YYYY");
}

export function getPageRange(offset: number, count: number, total: number): PageRange {
	if (total === 0 || count === 0) return { start: 0, end: 0, total };

	return {
		start: offset + 1,
		end: Math.min(offset + count, total),
		total,
	};
}

export function getMailboxAddress(
	mailbox:
		| (Partial<Pick<MailboxOption, "localPart" | "hostname">> &
				Pick<MailboxOption, "senderAddresses">)
		| null
		| undefined,
): string | null {
	if (!mailbox) return null;
	if (!mailbox.localPart || !mailbox.hostname) {
		return mailbox.senderAddresses?.find((address) => address.includes("@")) ?? null;
	}
	return `${mailbox.localPart}@${mailbox.hostname}`;
}

export function formatEmailPageTitle({
	location,
	unread,
	emailAddress,
}: EmailPageTitleInput): string {
	const count = unread > 0 ? ` (${unread})` : "";
	const suffix = emailAddress ? ` - ${emailAddress}` : "";
	return `${location}${count}${suffix}`;
}

export function getBulkActionScope(folder: MessageFolderConfig["folder"]): BulkMessageScope {
	return folder === "drafts" ? "message" : "thread";
}

export async function runBulkMessageAction(
	messageIds: string[],
	action: string,
	notify = true,
	scope: BulkMessageScope = "message",
) {
	const response = await authFetch("/api/messages/bulk", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ messageIds, action, scope }),
	});

	if (!response.ok) throw new Error("Unable to update selected messages");
	if (notify) window.dispatchEvent(new Event("mailflare:messages-changed"));
}

/** The read state a bulk or row action sets, or `null` for actions that move mail. */
export function getReadValueForAction(action: string): boolean | null {
	if (action === "read") return true;
	if (action === "unread") return false;
	return null;
}

/** How a row action changes the inbox unread badge. */
export function getUnreadDeltaForAction(action: string): number {
	const readValue = getReadValueForAction(action);
	if (readValue === null) return 0;
	return readValue ? -1 : 1;
}

/** Badge change from setting `readValue` on received rows whose read state differs from it. */
export function getInboxUnreadDelta(messages: Message[], readValue: boolean): number {
	const changed = messages.filter(
		(message) => message.read !== readValue && isInboundConversationRow(message),
	).length;
	return readValue ? -changed : changed;
}
