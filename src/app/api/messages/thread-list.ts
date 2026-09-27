import { and, count, desc, eq, inArray, lte, max, ne, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { messageAttachments, messages } from "@/db/schema";
import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { getEmailAddress, getEmailDisplayName, normalizeEmailAddress } from "@/lib/email/address";
import { buildSnippet } from "@/lib/email/parse";
import type { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { encodeMessagePageCursor } from "@/lib/messages/pagination";

export async function listMessageThreads(input: {
	env: CloudflareEnv;
	matchingWhere: SQL | undefined;
	accessWhere: SQL | undefined;
	accessibleMailboxes: Awaited<ReturnType<typeof listAccessibleMailboxes>>;
	includeTrash: boolean;
	includeSpam: boolean;
	limit: number;
	offset: number;
	pagination?: {
		snapshotAt: Date;
		boundary?: { createdAt: Date; id: string };
	};
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
	if (input.pagination)
		candidateConditions.push(lte(messages.createdAt, input.pagination.snapshotAt));
	const candidateWhere = and(...candidateConditions);
	const lastMessageAt = max(messages.createdAt);
	const total = input.pagination?.boundary
		? undefined
		: ((await db.select({ total: count() }).from(matchedThreads))[0]?.total ?? 0);
	const page = await db
		.select({ id: threadKey, lastMessageAt })
		.from(messages)
		.innerJoin(matchedThreads, eq(threadKey, sql<string>`"matched_threads"."thread_key"`))
		.where(candidateWhere)
		.groupBy(threadKey)
		.having(
			input.pagination?.boundary
				? or(
						sql`${lastMessageAt} < ${Math.floor(
							input.pagination.boundary.createdAt.getTime() / 1_000,
						)}`,
						and(
							sql`${lastMessageAt} = ${Math.floor(
								input.pagination.boundary.createdAt.getTime() / 1_000,
							)}`,
							sql`${threadKey} < ${input.pagination.boundary.id}`,
						),
					)
				: undefined,
		)
		.orderBy(desc(lastMessageAt), desc(threadKey))
		.limit(input.pagination ? input.limit + 1 : input.limit)
		.offset(input.pagination ? 0 : input.offset);
	const hasNextPage = Boolean(input.pagination) && page.length > input.limit;
	const pageRows = hasNextPage ? page.slice(0, input.limit) : page;
	if (pageRows.length === 0) {
		return NextResponse.json({
			messages: [],
			total,
			limit: input.limit,
			offset: input.pagination ? undefined : input.offset,
		});
	}

	const rows = await db
		.select()
		.from(messages)
		.where(
			and(
				candidateWhere,
				inArray(
					threadKey,
					pageRows.map((item) => item.id),
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
								.flatMap((message) => [message.fromAddr, message.toAddr, message.ccAddr]),
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

	const responseRows = pageRows.flatMap((pageThread) => {
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
	const lastPageThread = hasNextPage ? pageRows.at(-1) : undefined;
	const nextCursor =
		input.pagination && lastPageThread?.lastMessageAt
			? encodeMessagePageCursor({
					kind: "threads",
					snapshotAt: input.pagination.snapshotAt,
					boundary: {
						createdAt: lastPageThread.lastMessageAt,
						id: lastPageThread.id,
					},
				})
			: undefined;

	return NextResponse.json({
		messages: responseRows,
		total,
		limit: input.limit,
		offset: input.pagination ? undefined : input.offset,
		nextCursor,
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
