import { NextResponse } from "next/server";
import {
	eq,
	desc,
	and,
	or,
	count,
	getTableColumns,
	isNull,
	lte,
	lt,
	gt,
	sql,
	ne,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getEnv } from "@/lib/cloudflare";
import { getCurrentUser } from "@/lib/auth/cookies";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { getContactDisplayNameMap } from "@/lib/contacts/service";
import { normalizeEmailAddress } from "@/lib/email/address";
import { buildSnippet } from "@/lib/email/parse";
import { listAccessibleMailboxes } from "@/lib/mailboxes/access";
import { getMessageAccessCondition, getMessageSearchConditions } from "./search-utils";
import { listMessageThreads } from "./thread-list";
import { MessageSearchValidationError, parseMessageSearchParams } from "@/lib/messages/search";
import {
	decodeMessagePageCursor,
	encodeMessagePageCursor,
	MessagePaginationValidationError,
} from "@/lib/messages/pagination";
import type { MessagePageCursor } from "@/lib/messages/pagination";

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
	const read = url.searchParams.get("read");
	const starred = url.searchParams.get("starred");
	const snoozed = url.searchParams.get("snoozed");
	const view = url.searchParams.get("view");
	let searchFilters;
	let pageCursor: MessagePageCursor | undefined;
	try {
		searchFilters = parseMessageSearchParams(url.searchParams);
		pageCursor = searchFilters.cursor
			? decodeMessagePageCursor(
					searchFilters.cursor,
					view === "threads" && status !== "draft" ? "threads" : "messages",
				)
			: undefined;
	} catch (error) {
		if (
			error instanceof MessageSearchValidationError ||
			error instanceof MessagePaginationValidationError
		) {
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		throw error;
	}
	const { limit, offset } = searchFilters;
	const cursorPagination = searchFilters.pagination === "cursor";
	const snapshotAt = pageCursor?.snapshotAt ?? new Date();

	const db = getDb(env);
	const accessibleMailboxes = await listAccessibleMailboxes(db, user);
	const accessibleMailboxIds = accessibleMailboxes.map((mailbox) => mailbox.id);
	const access = getMessageAccessCondition(user.id, accessibleMailboxIds, mailboxId);
	if (!access.allowed) {
		return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
	}
	const conditions: SQL[] = [access.condition];
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
	conditions.push(...getMessageSearchConditions(searchFilters));
	if (cursorPagination) conditions.push(lte(messages.createdAt, snapshotAt));
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
			pagination: cursorPagination ? { snapshotAt, boundary: pageCursor?.boundary } : undefined,
		});
	}
	if (pageCursor) {
		conditions.push(
			or(
				lt(messages.createdAt, pageCursor.boundary.createdAt),
				and(
					eq(messages.createdAt, pageCursor.boundary.createdAt),
					lt(messages.id, pageCursor.boundary.id),
				),
			)!,
		);
	}
	const where = and(...conditions);

	const rows = await db
		.select({
			...getTableColumns(messages),
			searchResultTotal: cursorPagination
				? sql<number | null>`NULL`
				: sql<number>`count(*) OVER ()`,
		})
		.from(messages)
		.where(where)
		.orderBy(desc(messages.createdAt), desc(messages.id))
		.limit(cursorPagination ? limit + 1 : limit)
		.offset(cursorPagination ? 0 : offset);
	const hasNextPage = cursorPagination && rows.length > limit;
	const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
	const total = cursorPagination
		? pageCursor
			? undefined
			: ((await db.select({ total: count() }).from(messages).where(where))[0]?.total ?? 0)
		: (rows[0]?.searchResultTotal ??
			(offset > 0
				? ((await db.select({ total: count() }).from(messages).where(where))[0]?.total ?? 0)
				: 0));
	const mailboxNameMap = new Map(
		accessibleMailboxes.map((mailbox) => [mailbox.id, mailbox.displayName ?? mailbox.localPart]),
	);
	const contactMapsByUserId = new Map(
		await Promise.all(
			Array.from(new Set(pageRows.map((message) => message.userId))).map(
				async (userId) =>
					[
						userId,
						await getContactDisplayNameMap(
							env,
							userId,
							pageRows
								.filter((message) => message.userId === userId)
								.flatMap((message) => [message.fromAddr, message.toAddr, message.ccAddr]),
						),
					] as const,
			),
		),
	);
	const enrichedRows = pageRows.map(
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
	const lastRow = hasNextPage ? pageRows.at(-1) : undefined;
	const nextCursor = lastRow
		? encodeMessagePageCursor({
				kind: "messages",
				snapshotAt,
				boundary: { createdAt: lastRow.createdAt, id: lastRow.id },
			})
		: undefined;

	return NextResponse.json({
		messages: enrichedRows,
		total,
		limit,
		offset: cursorPagination ? undefined : offset,
		nextCursor,
	});
}
