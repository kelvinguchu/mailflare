import { and, asc, count, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { messages, messageAttachments, messageDeletionEvents } from "@/db/schema";
import { getMessageSearchConditions } from "@/app/api/messages/search-utils";
import { parseMessageSearchParams } from "@/lib/messages/search";
import { inspectionOwnerEmail } from "./policy";
export function teamMessageScope(env: CloudflareEnv): SQL {
	return sql`NOT (lower(coalesce(${messages.originalUserEmail}, '')) = ${inspectionOwnerEmail(env) ?? ""} AND coalesce(${messages.originalMailboxType}, '') = 'personal') AND ${messages.consumedByMessageId} IS NULL`;
}
export async function inspectSearch(env: CloudflareEnv, params: URLSearchParams) {
	const filters = parseMessageSearchParams(params);
	const conditions: SQL[] = [teamMessageScope(env)];
	const mailboxId = params.get("mailboxId");
	if (mailboxId)
		conditions.push(
			or(eq(messages.mailboxId, mailboxId), eq(messages.originalMailboxId, mailboxId))!,
		);
	const folder = params.get("folder") ?? "all";
	const originalStatus = sql<string>`CASE WHEN ${messages.status} = 'trash' OR ${messages.employeeHiddenAt} IS NOT NULL THEN coalesce(${messages.deletionOriginalStatus}, ${messages.status}) ELSE ${messages.status} END`;
	const originalFolder = sql<string>`CASE WHEN ${messages.status} = 'trash' OR ${messages.employeeHiddenAt} IS NOT NULL THEN ${messages.deletionOriginalFolderId} ELSE ${messages.folderId} END`;
	const statusByFolder: Record<string, string> = {
		inbox: "received",
		sent: "sent",
		drafts: "draft",
		archived: "archived",
		spam: "spam",
		trash: "trash",
	};
	if (folder === "deleted")
		conditions.push(or(isNotNull(messages.employeeHiddenAt), eq(messages.status, "trash"))!);
	else if (folder === "trash") conditions.push(eq(messages.status, "trash"));
	else if (statusByFolder[folder]) {
		conditions.push(sql`${originalStatus} = ${statusByFolder[folder]}`);
		if (folder === "inbox") conditions.push(sql`${originalFolder} IS NULL`);
	} else if (folder !== "all") conditions.push(sql`${originalFolder} = ${folder}`);
	const deletion = params.get("deletion");
	if (deletion === "removed") conditions.push(isNotNull(messages.employeeHiddenAt));
	else if (deletion === "trash")
		conditions.push(eq(messages.status, "trash"), isNull(messages.employeeHiddenAt));
	else if (deletion === "history")
		conditions.push(
			sql`EXISTS (SELECT 1 FROM message_deletion_events WHERE message_id = ${messages.id})`,
		);
	conditions.push(...getMessageSearchConditions(filters));
	const db = getDb(env),
		where = and(...conditions);
	const rows = await db
		.select({
			id: messages.id,
			mailboxId: messages.originalMailboxId,
			mailboxAddress: messages.originalMailboxAddress,
			employeeEmail: messages.originalUserEmail,
			subject: messages.subject,
			snippet: sql<
				string | null
			>`CASE WHEN ${messages.securityStatus} = 'quarantined' THEN 'Message quarantined for security review' ELSE coalesce(${messages.snippet}, substr(${messages.textBody}, 1, 200)) END`,
			fromAddr: messages.fromAddr,
			toAddr: messages.toAddr,
			direction: messages.direction,
			status: messages.status,
			read: messages.read,
			createdAt: messages.createdAt,
			employeeHiddenAt: messages.employeeHiddenAt,
			originalStatus: messages.deletionOriginalStatus,
			securityStatus: messages.securityStatus,
			hasDeletionHistory: sql<boolean>`EXISTS (SELECT 1 FROM message_deletion_events WHERE message_id = ${messages.id})`,
		})
		.from(messages)
		.where(where)
		.orderBy(desc(messages.createdAt), desc(messages.id))
		.limit(filters.limit)
		.offset(filters.offset);
	const total = (await db.select({ total: count() }).from(messages).where(where))[0]?.total ?? 0;
	return { messages: rows, total, limit: filters.limit, offset: filters.offset };
}
export async function inspectMessage(env: CloudflareEnv, id: string) {
	const db = getDb(env);
	const [row] = await db
		.select()
		.from(messages)
		.where(and(eq(messages.id, id), teamMessageScope(env)))
		.limit(1);
	if (!row) return null;
	const attachments = await db
		.select({
			id: messageAttachments.id,
			messageId: messageAttachments.messageId,
			filename: messageAttachments.filename,
			type: messageAttachments.contentType,
			size: messageAttachments.size,
			disposition: messageAttachments.disposition,
			contentId: messageAttachments.contentId,
			securityStatus: messageAttachments.securityStatus,
			securityReason: messageAttachments.securityReason,
		})
		.from(messageAttachments)
		.where(eq(messageAttachments.messageId, id));
	const history = await db
		.select()
		.from(messageDeletionEvents)
		.where(eq(messageDeletionEvents.messageId, id))
		.orderBy(asc(messageDeletionEvents.createdAt));
	const { rawR2Key: _raw, htmlBody, textBody, ...message } = row;
	return {
		message: {
			...message,
			...(row.securityStatus === "quarantined"
				? { snippet: "Message quarantined for security review" }
				: {}),
		},
		body: row.securityStatus === "quarantined" ? null : { htmlBody, textBody },
		attachments,
		history,
	};
}
export async function inspectConversation(env: CloudflareEnv, id: string) {
	const db = getDb(env);
	const target = await inspectMessage(env, id);
	if (!target) return null;
	const condition =
		target.message.threadId && target.message.originalMailboxId
			? and(
					eq(messages.originalMailboxId, target.message.originalMailboxId),
					eq(messages.threadId, target.message.threadId),
				)
			: eq(messages.id, id);
	const rows = await db
		.select({ id: messages.id })
		.from(messages)
		.where(and(teamMessageScope(env), condition))
		.orderBy(asc(messages.createdAt), asc(messages.id))
		.limit(100);
	const ids = rows.map((row) => row.id);
	if (!ids.includes(id)) ids.push(id);
	return {
		messages: await Promise.all(ids.map((messageId) => inspectMessage(env, messageId))),
		truncated: rows.length === 100,
	};
}
