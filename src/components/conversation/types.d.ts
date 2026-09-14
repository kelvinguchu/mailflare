import type { Message } from "@/hooks/types";

export type ParticipantToken = { kind: "name"; label: string; unread: boolean } | { kind: "gap" };

export type ConversationItem =
	| { kind: "message"; message: Message; expanded: boolean }
	| { kind: "hidden"; count: number; messageIds: string[] };

export type ReplyMode = "reply" | "forward";
