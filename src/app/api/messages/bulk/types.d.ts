export type BulkMessageAction =
	"archive" | "trash" | "spam" | "read" | "unread" | "inbox" | "folder";

/** `thread` applies the action to every message in the selected conversations. */
export type BulkMessageScope = "message" | "thread";

export type BulkMessagePayload = {
	messageIds?: string[];
	scope?: BulkMessageScope;
	action?: BulkMessageAction;
	folderId?: string;
};
