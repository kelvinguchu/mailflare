import type { MessageCounts, MessageFolder } from "@/hooks/types";
import type { messages } from "@/db/schema";

export type MessageCountRow = Pick<
	typeof messages.$inferSelect,
	| "id"
	| "mailboxId"
	| "folderId"
	| "direction"
	| "status"
	| "read"
	| "starred"
	| "snoozedUntil"
	| "threadId"
>;

export type FolderAccumulator = MessageCounts["folders"];

export type CountableFolder = MessageFolder | null;
