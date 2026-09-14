import { and, desc, eq, inArray, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { folders, messages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getEnv } from "@/lib/cloudflare";
import { getMailboxAccessLevel } from "@/lib/mailboxes/access";
import { createAuditLog } from "@/lib/mailboxes/audit";
import type { BulkMessageAction, BulkMessagePayload } from "./types";
import {
	getReadValueForBulkAction,
	getStatusForBulkAction,
	isAllowedBulkMessageAction,
} from "./utils";

type MessageRow = typeof messages.$inferSelect;

export async function POST(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

	const payload = (await request.json()) as BulkMessagePayload;
	const messageIds = Array.from(new Set(payload.messageIds?.filter(Boolean) ?? []));
	if (
		messageIds.length === 0 ||
		!isAllowedBulkMessageAction(payload.action) ||
		(payload.scope !== undefined && payload.scope !== "message" && payload.scope !== "thread")
	) {
		return NextResponse.json({ error: "Invalid bulk message action" }, { status: 400 });
	}

	const db = getDb(env);
	let destinationFolder: { id: string; mailboxId: string } | null = null;
	if (payload.action === "folder") {
		if (!payload.folderId) {
			return NextResponse.json({ error: "Folder is required" }, { status: 400 });
		}
		const [folder] = await db
			.select({ id: folders.id, mailboxId: folders.mailboxId })
			.from(folders)
			.where(eq(folders.id, payload.folderId))
			.limit(1);
		if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
		const access = await getMailboxAccessLevel(db, user, folder.mailboxId);
		if (!access?.canManage) {
			return NextResponse.json({ error: "Folder not found" }, { status: 404 });
		}
		destinationFolder = folder;
	}

	const selected = await db.select().from(messages).where(inArray(messages.id, messageIds));
	const accessCache = new Map<string, Awaited<ReturnType<typeof getMailboxAccessLevel>>>();
	const canUpdate = async (message: MessageRow): Promise<boolean> => {
		if (!message.mailboxId) return false;
		let access = accessCache.get(message.mailboxId);
		if (access === undefined) {
			access = await getMailboxAccessLevel(db, user, message.mailboxId);
			accessCache.set(message.mailboxId, access);
		}
		return payload.action === "read" || payload.action === "unread"
			? !!access?.canRead
			: !!access?.canManage;
	};
	const readableSelected: MessageRow[] = [];
	for (const message of selected) {
		if (await canUpdate(message)) readableSelected.push(message);
	}
	if (readableSelected.length === 0) {
		return NextResponse.json({ error: "No accessible messages" }, { status: 404 });
	}

	let targetMessages = readableSelected;
	if (payload.scope === "thread") {
		const threadConditions = readableSelected.map((message) =>
			message.threadId && message.mailboxId
				? and(eq(messages.mailboxId, message.mailboxId), eq(messages.threadId, message.threadId))
				: eq(messages.id, message.id),
		);
		const expanded = await db
			.select()
			.from(messages)
			.where(or(...threadConditions))
			.orderBy(desc(messages.createdAt), desc(messages.id));
		targetMessages = [];
		for (const message of expanded) {
			if (await canUpdate(message)) targetMessages.push(message);
		}
	}

	if (destinationFolder) {
		targetMessages = targetMessages.filter(
			(message) => message.mailboxId === destinationFolder.mailboxId,
		);
	}
	const affectedIds = await applyMessageBulkAction(
		db,
		targetMessages,
		payload.action,
		payload.scope === "thread",
		destinationFolder?.id,
	);
	if (affectedIds.length === 0) {
		return NextResponse.json({ error: "No accessible messages" }, { status: 404 });
	}

	const auditMessages =
		payload.scope === "thread"
			? Array.from(
					new Map(
						targetMessages.map((message) => [
							`${message.mailboxId ?? ""}:${message.threadId ?? message.id}`,
							message,
						]),
					).values(),
				)
			: targetMessages.filter((message) => affectedIds.includes(message.id));
	await Promise.all(
		auditMessages.map((message) =>
			createAuditLog(env, {
				actorUserId: user.id,
				mailboxId: message.mailboxId,
				messageId: message.id,
				action:
					payload.action === "read" || payload.action === "unread" ? "email.read" : "email.delete",
				metadata: {
					bulkAction: payload.action,
					scope: payload.scope ?? "message",
					...(payload.scope === "thread" ? { threadId: message.threadId ?? message.id } : {}),
				},
			}),
		),
	);

	return NextResponse.json({ ok: true, affected: affectedIds.length });
}

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
