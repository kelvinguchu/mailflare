import dayjs from "dayjs";
import type { Message, MessageThread, ThreadParticipant } from "@/hooks/types";
import { authFetch } from "@/lib/auth/client";
import { getDisplayNameForAddress } from "@/lib/contacts/utils";
import { getEmailAddress } from "@/lib/email/address";
import { formatRecipientList, parseRecipientList } from "@/lib/email/recipients";
import type { ConversationItem, ParticipantToken } from "./types";

export async function fetchMessageThread(messageId: string): Promise<MessageThread | null> {
	const response = await authFetch(`/api/messages/${messageId}/thread`);
	const data = (await response.json().catch(() => null)) as {
		thread?: MessageThread;
		error?: string;
	} | null;
	if (response.ok && data?.thread) return data.thread;
	return null;
}

function firstName(participant: Pick<ThreadParticipant, "name" | "address">): string {
	const name = participant.name.trim();
	if (!name || name.includes("@")) return getEmailAddress(participant.address).split("@")[0];
	return name.split(/\s+/)[0];
}

/**
 * Gmail-style sender list: "me, Maya" or "Alice .. Bob, me". Full names are used
 * only when a single participant fits, and each unread sender is marked.
 */
export function formatThreadParticipants(
	participants: ThreadParticipant[],
	maxVisible = 3,
): ParticipantToken[] {
	const toToken = (participant: ThreadParticipant, short: boolean): ParticipantToken => ({
		kind: "name",
		label: participant.isMe
			? "me"
			: short
				? firstName(participant)
				: participant.name || participant.address,
		unread: participant.unread,
	});
	if (participants.length === 0) return [];
	if (participants.length === 1) return [toToken(participants[0], false)];
	if (participants.length <= maxVisible) {
		return participants.map((participant) => toToken(participant, true));
	}
	const tail = participants.slice(-(maxVisible - 1));
	return [toToken(participants[0], true), { kind: "gap" }, ...tail.map((p) => toToken(p, true))];
}

export function isUnreadMessage(message: Pick<Message, "direction" | "read">): boolean {
	return message.direction === "inbound" && !message.read;
}

/** The newest message plus every unread one open by default, like Gmail. */
export function getInitialExpandedIds(messages: Message[], openedMessageId?: string): Set<string> {
	const expanded = new Set(messages.filter(isUnreadMessage).map((message) => message.id));
	const latest = messages.at(-1);
	if (latest) expanded.add(latest.id);
	if (openedMessageId && messages.some((message) => message.id === openedMessageId)) {
		expanded.add(openedMessageId);
	}
	return expanded;
}

/**
 * Collapses long runs of read messages: the first message stays visible, the middle
 * of the run becomes an "N older messages" pill, and the message before the next
 * expanded one stays visible for context.
 */
export function buildConversationItems(
	messages: Message[],
	expandedIds: Set<string>,
	showAll: boolean,
	minimumHidden = 2,
): ConversationItem[] {
	const items: ConversationItem[] = [];
	let run: Message[] = [];

	const flush = () => {
		if (!showAll && run.length >= minimumHidden + 2) {
			const hidden = run.slice(1, -1);
			items.push({ kind: "message", message: run[0], expanded: false });
			items.push({
				kind: "hidden",
				count: hidden.length,
				messageIds: hidden.map((item) => item.id),
			});
			items.push({ kind: "message", message: run[run.length - 1], expanded: false });
		} else {
			for (const message of run) items.push({ kind: "message", message, expanded: false });
		}
		run = [];
	};

	for (const message of messages) {
		if (expandedIds.has(message.id)) {
			flush();
			items.push({ kind: "message", message, expanded: true });
		} else {
			run.push(message);
		}
	}
	flush();
	return items;
}

/** Who a reply to this message goes to, and which of our addresses it comes from. */
export function getReplyAddresses(
	message: Pick<Message, "direction" | "fromAddr" | "toAddr" | "ccAddr" | "deliveredToAddr">,
) {
	const own = getEmailAddress(
		message.direction === "inbound"
			? (message.deliveredToAddr ?? message.toAddr)
			: message.fromAddr,
	).toLowerCase();
	if (message.direction === "outbound") {
		return { to: message.toAddr, cc: message.ccAddr ?? "", own };
	}

	const sender = safeRecipients(message.fromAddr)[0];
	const excluded = new Set([own, sender?.address].filter(Boolean));
	const cc = [...safeRecipients(message.toAddr), ...safeRecipients(message.ccAddr)].filter(
		(recipient, index, all) =>
			!excluded.has(recipient.address) &&
			all.findIndex((item) => item.address === recipient.address) === index,
	);
	return {
		to: sender?.formatted ?? getEmailAddress(message.fromAddr),
		cc: formatRecipientList(cc),
		own,
	};
}

export function buildForwardSubject(subject: string | null | undefined): string {
	const trimmed = (subject ?? "").trim();
	if (!trimmed) return "Fwd:";
	return /^(fwd?|fw):/i.test(trimmed) ? trimmed : `Fwd: ${trimmed}`;
}

export function buildForwardText(
	message: Pick<Message, "fromAddr" | "toAddr" | "ccAddr" | "subject" | "createdAt">,
	bodyText: string | null | undefined,
): string {
	return [
		"",
		"",
		"---------- Forwarded message ---------",
		`From: ${message.fromAddr}`,
		`Date: ${dayjs(message.createdAt).format("ddd, MMM D, YYYY [at] h:mm A")}`,
		`Subject: ${message.subject ?? "(no subject)"}`,
		`To: ${message.toAddr}`,
		...(message.ccAddr ? [`Cc: ${message.ccAddr}`] : []),
		"",
		(bodyText ?? "").trim(),
		"",
	].join("\n");
}

function safeRecipients(value: string | null | undefined) {
	try {
		return parseRecipientList(value ?? "");
	} catch {
		return [];
	}
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelativeTime(date: Date | string, now = new Date()): string {
	const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1_000);
	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		["year", 31_536_000],
		["month", 2_592_000],
		["week", 604_800],
		["day", 86_400],
		["hour", 3_600],
		["minute", 60],
	];
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return relativeTime.format(Math.trunc(seconds / size), unit);
	}
	return relativeTime.format(0, "minute");
}

/** "Sep 1, 2026, 10:33 AM (13 days ago)", or just the time and relative hint for today. */
export function formatConversationDate(date: Date | string, now = new Date()): string {
	const value = dayjs(date);
	const absolute = value.isSame(now, "day")
		? value.format("h:mm A")
		: value.format(value.isSame(now, "year") ? "MMM D, h:mm A" : "MMM D, YYYY, h:mm A");
	return `${absolute} (${formatRelativeTime(date, now)})`;
}

export function formatCollapsedDate(date: Date | string, now = new Date()): string {
	const value = dayjs(date);
	if (value.isSame(now, "day")) return value.format("h:mm A");
	return value.format(value.isSame(now, "year") ? "MMM D" : "MMM D, YYYY");
}

export function getSenderName(message: Message): string {
	if (message.direction === "outbound") return "me";
	return getDisplayNameForAddress(message.fromAddr, message.fromContactName);
}

/** The folder a conversation is being read from, shown as a chip beside the subject. */
export function getMessageFolderLabel(
	message: Pick<Message, "status" | "direction">,
): string | null {
	switch (message.status) {
		case "received":
			return "Inbox";
		case "archived":
			return "Archived";
		case "spam":
			return "Spam";
		case "trash":
			return "Trash";
		case "sent":
		case "scheduled":
		case "queued":
			return "Sent";
		default:
			return null;
	}
}

export function getAvatarInitials(name: string): string {
	const words = name
		.replace(/[<>"]/g, "")
		.trim()
		.split(/[\s._-]+/)
		.filter(Boolean);
	if (words.length === 0) return "?";
	const letters =
		words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words.at(-1)?.[0] ?? ""}`;
	return letters.toUpperCase();
}

const AVATAR_COLORS = [
	"bg-sky-100 text-sky-800",
	"bg-emerald-100 text-emerald-800",
	"bg-amber-100 text-amber-800",
	"bg-rose-100 text-rose-800",
	"bg-violet-100 text-violet-800",
	"bg-teal-100 text-teal-800",
	"bg-orange-100 text-orange-800",
	"bg-indigo-100 text-indigo-800",
];

/** A stable tint per address so the same person keeps the same avatar color. */
export function getAvatarColor(address: string): string {
	let hash = 0;
	for (const character of getEmailAddress(address).toLowerCase()) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
