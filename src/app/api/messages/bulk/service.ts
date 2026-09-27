import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import type { BulkMessageAction } from "./types";
import { getReadValueForBulkAction, getStatusForBulkAction } from "./utils";

type MessageRow = typeof messages.$inferSelect;

export async function applyMessageBulkAction(
	db: ReturnType<typeof getDb>,
	targets: MessageRow[],
	action: BulkMessageAction,
	threadScope: boolean,
	folderId?: string,
): Promise<string[]> {
	if (!threadScope) {
		const ids = targets.map((message) => message.id);
		const status = getStatusForBulkAction(action);
		const read = getReadValueForBulkAction(action);
		const values = {
			...(status ? { status } : {}),
			...(read !== null ? { read } : {}),
			...(action === "folder" ? { folderId: folderId ?? null } : {}),
			...(["archive", "trash", "spam", "inbox"].includes(action) ? { folderId: null } : {}),
		};
		await db.update(messages).set(values).where(inArray(messages.id, ids));
		return ids;
	}

	const inbound = targets.filter((message) => message.direction === "inbound");
	if (action === "read") {
		const ids = inbound.map((message) => message.id);
		if (ids.length > 0)
			await db.update(messages).set({ read: true }).where(inArray(messages.id, ids));
		return ids;
	}
	if (action === "unread") {
		const newestByThread = new Map<string, MessageRow>();
		for (const message of inbound) {
			const key = `${message.mailboxId ?? ""}:${message.threadId ?? message.id}`;
			if (!newestByThread.has(key)) newestByThread.set(key, message);
		}
		const allIds = inbound.map((message) => message.id);
		const newestIds = Array.from(newestByThread.values(), (message) => message.id);
		if (allIds.length > 0) {
			await db.update(messages).set({ read: true }).where(inArray(messages.id, allIds));
			await db.update(messages).set({ read: false }).where(inArray(messages.id, newestIds));
		}
		return newestIds;
	}

	const movable = action === "trash" ? targets : inbound;
	const ids = movable.map((message) => message.id);
	if (ids.length === 0) return [];
	await db
		.update(messages)
		.set({
			status: getStatusForBulkAction(action) ?? undefined,
			folderId: action === "folder" ? (folderId ?? null) : null,
		})
		.where(inArray(messages.id, ids));
	return ids;
}
