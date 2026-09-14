import { NextResponse } from "next/server";
import {
	eq,
	desc,
	and,
	or,
	count,
	getTableColumns,
	isNull,
	inArray,
	lte,
	gt,
	sql,
	max,
	ne,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { getEmailAddress, getEmailDisplayName, normalizeEmailAddress } from "@/lib/email/address";
import { messageAttachments } from "@/db/schema";
import { buildSnippet } from "@/lib/email/parse";
import { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { getMessageTextSearchCondition, getMessageTitleSearchCondition } from "./search-utils";

export async function GET(request: Request) {
	const env = getEnv();
	const user = await getCurrentUser(env, request);
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const url = new URL(request.url);
	const direction = url.searchParams.get("direction");
	const mailboxId = url.searchParams.get("mailboxId");
	const folderId = url.searchParams.get("folderId");
	const status = url.searchParams.get("status");
	const query = url.searchParams.get("q")?.trim();
	const title = url.searchParams.get("title")?.trim();
	const read = url.searchParams.get("read");
	const starred = url.searchParams.get("starred");
	const snoozed = url.searchParams.get("snoozed");
	const view = url.searchParams.get("view");
	const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
	const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);

	const db = getDb(env);
	const accessibleMailboxes = await listAccessibleMailboxes(db, user);
	const accessibleMailboxIds = accessibleMailboxes.map((mailbox) => mailbox.id);
	const conditions: SQL[] = [];
	if (mailboxId) {
		if (!accessibleMailboxIds.includes(mailboxId)) {
			return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
		}
		conditions.push(eq(messages.mailboxId, mailboxId));
	} else if (accessibleMailboxIds.length > 0) {
		conditions.push(inArray(messages.mailboxId, accessibleMailboxIds));
	} else {
		conditions.push(eq(messages.userId, user.id));
	}
	const accessConditions = [...conditions];
	if (direction === "inbound" || direction === "outbound") {
		conditions.push(eq(messages.direction, direction));
	}
	if (folderId) {
		conditions.push(eq(messages.folderId, folderId));
	}
	if (status) {
		conditions.push(eq(messages.status, status));
	}
	if (status === "received" && !folderId) {
		conditions.push(isNull(messages.folderId));
		conditions.push(or(isNull(messages.snoozedUntil), lte(messages.snoozedUntil, new Date()))!);
	}
	if (starred === "true") {
		conditions.push(eq(messages.starred, true));
	}
	if (snoozed === "true") {
		conditions.push(eq(messages.status, "received"));
		conditions.push(isNull(messages.folderId));
		conditions.push(gt(messages.snoozedUntil, new Date()));
	}
	if (read === "read") {
		conditions.push(eq(messages.read, true));
	}
	if (read === "unread") {
		conditions.push(eq(messages.read, false));
		if (view === "threads") conditions.push(eq(messages.direction, "inbound"));
	}
	if (query) {
		conditions.push(getMessageTextSearchCondition(query));
	}
	if (title) {
		conditions.push(getMessageTitleSearchCondition(title));
	}
	if (view === "threads" && status !== "draft") {
		conditions.push(ne(messages.status, "draft"));
		if (status !== "trash") conditions.push(ne(messages.status, "trash"));
		if (status !== "spam") conditions.push(ne(messages.status, "spam"));
		return listMessageThreads({
			env,
			matchingWhere: and(...conditions),
			accessWhere: and(...accessConditions),
			accessibleMailboxes,
			includeTrash: status === "trash",
			includeSpam: status === "spam",
			limit,
			offset,
		});
	}
	const where = and(...conditions);

	const rows = await db
		.select({
			...getTableColumns(messages),
			searchResultTotal: sql<number>`count(*) OVER ()`,
		})
		.from(messages)
		.where(where)
		.orderBy(desc(messages.createdAt))
		.limit(limit)
		.offset(offset);
	const total =
		rows[0]?.searchResultTotal ??
		(offset > 0
			? ((await db.select({ total: count() }).from(messages).where(where))[0]?.total ?? 0)
			: 0);
	const mailboxNameMap = new Map(
		accessibleMailboxes.map((mailbox) => [mailbox.id, mailbox.displayName ?? mailbox.localPart]),
	);
	const contactMapsByUserId = new Map(
		await Promise.all(
			Array.from(new Set(rows.map((message) => message.userId))).map(
				async (userId) =>
					[
						userId,
						await getContactDisplayNameMap(
							env,
							userId,
							rows
								.filter((message) => message.userId === userId)
								.flatMap((message) => [message.fromAddr, message.toAddr]),
						),
					] as const,
			),
		),
	);
	const enrichedRows = rows.map(
		({ rawR2Key: _rawR2Key, searchResultTotal: _searchResultTotal, ...message }) => {
			const contactMap = contactMapsByUserId.get(message.userId);
			const accountName = message.mailboxId ? mailboxNameMap.get(message.mailboxId) : null;
			return {
				...message,
				snippet:
					message.securityStatus === "quarantined"
						? "Message quarantined for security review"
						: buildSnippet(message.textBody, message.htmlBody) || message.snippet,
				fromContactName:
					(message.direction === "outbound" ? accountName : null) ??
					contactMap?.get(normalizeEmailAddress(message.fromAddr)) ??
					null,
				toContactName: contactMap?.get(normalizeEmailAddress(message.toAddr)) ?? null,
			};
		},
	);

	return NextResponse.json({ messages: enrichedRows, total, limit, offset });
}

export async function listMessageThreads(input: {
	env: CloudflareEnv;
	matchingWhere: SQL | undefined;
	accessWhere: SQL | undefined;
	accessibleMailboxes: Awaited<ReturnType<typeof listAccessibleMailboxes>>;
	includeTrash: boolean;
	includeSpam: boolean;
	limit: number;
	offset: number;
}) {
	const db = getDb(input.env);
	const threadKey = sql<string>`coalesce(${messages.threadId}, ${messages.id})`;
	const matchedThreads = db
		.select({ id: threadKey.as("thread_key") })
		.from(messages)
		.where(input.matchingWhere)
		.groupBy(threadKey)
		.as("matched_threads");
	const candidateConditions: SQL[] = [ne(messages.status, "draft")];
	if (input.accessWhere) candidateConditions.push(input.accessWhere);
	if (!input.includeTrash) candidateConditions.push(ne(messages.status, "trash"));
	if (!input.includeSpam) candidateConditions.push(ne(messages.status, "spam"));
	const candidateWhere = and(...candidateConditions);
	const lastMessageAt = max(messages.createdAt);
	const [{ total = 0 } = { total: 0 }] = await db.select({ total: count() }).from(matchedThreads);
	const page = await db
		.select({ id: threadKey, lastMessageAt })
		.from(messages)
		.innerJoin(matchedThreads, eq(threadKey, sql<string>`"matched_threads"."thread_key"`))
		.where(candidateWhere)
		.groupBy(threadKey)
		.orderBy(desc(lastMessageAt), desc(threadKey))
		.limit(input.limit)
		.offset(input.offset);
	if (page.length === 0) {
		return NextResponse.json({ messages: [], total, limit: input.limit, offset: input.offset });
	}

	const rows = await db
		.select()
		.from(messages)
		.where(
			and(
				candidateWhere,
				inArray(
					threadKey,
					page.map((item) => item.id),
				),
			),
		)
		.orderBy(messages.createdAt, messages.id);
	const attachmentRows = await db
		.select({ messageId: messageAttachments.messageId })
		.from(messageAttachments)
		.where(
			inArray(
				messageAttachments.messageId,
				rows.map((row) => row.id),
			),
		)
		.groupBy(messageAttachments.messageId);
	const attachmentMessageIds = new Set(attachmentRows.map((row) => row.messageId));
	const mailboxNameMap = new Map(
		input.accessibleMailboxes.map((mailbox) => [
			mailbox.id,
			mailbox.displayName ?? mailbox.localPart,
		]),
	);
	const contactMapsByUserId = new Map(
		await Promise.all(
			Array.from(new Set(rows.map((message) => message.userId))).map(
				async (userId) =>
					[
						userId,
						await getContactDisplayNameMap(
							input.env,
							userId,
							rows
								.filter((message) => message.userId === userId)
								.flatMap((message) => [message.fromAddr, message.toAddr]),
						),
					] as const,
			),
		),
	);
	const rowsByThread = new Map<string, typeof rows>();
	for (const row of rows) {
		const id = row.threadId ?? row.id;
		const threadRows = rowsByThread.get(id) ?? [];
		threadRows.push(row);
		rowsByThread.set(id, threadRows);
	}

	const responseRows = page.flatMap((pageThread) => {
		const threadRows = rowsByThread.get(pageThread.id) ?? [];
		const latest = threadRows.at(-1);
		if (!latest) return [];
		const unreadRows = threadRows.filter(
			(message) => message.direction === "inbound" && !message.read,
		);
		const contactMap = contactMapsByUserId.get(latest.userId);
		const accountName = latest.mailboxId ? mailboxNameMap.get(latest.mailboxId) : null;
		const participants = buildThreadParticipants(threadRows, contactMapsByUserId, mailboxNameMap);
		const { rawR2Key: _rawR2Key, ...message } = latest;
		return [
			{
				...message,
				snippet:
					latest.securityStatus === "quarantined"
						? "Message quarantined for security review"
						: buildSnippet(latest.textBody, latest.htmlBody) || latest.snippet,
				fromContactName:
					(latest.direction === "outbound" ? accountName : null) ??
					contactMap?.get(normalizeEmailAddress(latest.fromAddr)) ??
					null,
				toContactName: contactMap?.get(normalizeEmailAddress(latest.toAddr)) ?? null,
				read: unreadRows.length === 0,
				starred: threadRows.some((row) => row.starred),
				thread: {
					id: pageThread.id,
					messageCount: threadRows.length,
					unreadCount: unreadRows.length,
					hasAttachments: threadRows.some((row) => attachmentMessageIds.has(row.id)),
					lastMessageAt: latest.createdAt,
					participants,
				},
			},
		];
	});

	return NextResponse.json({
		messages: responseRows,
		total,
		limit: input.limit,
		offset: input.offset,
	});
}

function buildThreadParticipants(
	rows: Array<typeof messages.$inferSelect>,
	contactMapsByUserId: Map<string, Map<string, string>>,
	mailboxNameMap: Map<string, string>,
) {
	const sourceRows = rows.some((row) => row.direction === "inbound")
		? rows.map((row) => ({ row, addressValue: row.fromAddr, isMe: row.direction === "outbound" }))
		: rows.map((row) => ({ row, addressValue: row.toAddr, isMe: false }));
	const participants = new Map<
		string,
		{ name: string; address: string; isMe: boolean; unread: boolean }
	>();
	for (const { row, addressValue, isMe } of sourceRows) {
		const address = getEmailAddress(addressValue);
		const key = address.toLowerCase();
		const existing = participants.get(key);
		const unread = row.direction === "inbound" && !row.read;
		if (existing) {
			existing.unread ||= unread;
			continue;
		}
		const contactName = contactMapsByUserId.get(row.userId)?.get(key);
		participants.set(key, {
			name:
				(isMe && row.mailboxId ? mailboxNameMap.get(row.mailboxId) : null) ??
				contactName ??
				getEmailDisplayName(addressValue),
			address,
			isMe,
			unread,
		});
	}
	return Array.from(participants.values());
}
