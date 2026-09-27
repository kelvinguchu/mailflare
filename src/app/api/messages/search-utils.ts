import { eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { messageAttachments, messages } from "@/db/schema";
import {
	buildFtsPhrase,
	buildScopedFtsPhrase,
	type MessageSearchFilters,
} from "@/lib/messages/search";

export function getMessageTextSearchCondition(query: string): SQL {
	return getFtsCondition(buildFtsPhrase(query));
}

export function getMessageTitleSearchCondition(title: string): SQL {
	return getFtsCondition(buildScopedFtsPhrase("subject", title));
}

export function getMessageSenderSearchCondition(sender: string): SQL {
	return getFtsCondition(buildScopedFtsPhrase("sender", sender));
}

export function getMessageRecipientSearchCondition(recipient: string): SQL {
	return getFtsCondition(buildScopedFtsPhrase("recipients", recipient));
}

export function getMessageAttachmentCondition(hasAttachments: boolean): SQL {
	const existsQuery = sql`EXISTS (
		SELECT 1 FROM ${messageAttachments}
		WHERE ${messageAttachments.messageId} = ${messages.id}
	)`;
	return hasAttachments ? existsQuery : sql`NOT ${existsQuery}`;
}

export function getMessageAccessCondition(
	userId: string,
	accessibleMailboxIds: readonly string[],
	mailboxId?: string | null,
): { allowed: boolean; condition: SQL } {
	if (mailboxId) {
		return {
			allowed: accessibleMailboxIds.includes(mailboxId),
			condition: eq(messages.mailboxId, mailboxId),
		};
	}
	if (accessibleMailboxIds.length > 0) {
		return { allowed: true, condition: inArray(messages.mailboxId, [...accessibleMailboxIds]) };
	}
	return { allowed: true, condition: eq(messages.userId, userId) };
}

export function getMessageSearchConditions(filters: MessageSearchFilters): SQL[] {
	const conditions: SQL[] = [];
	if (filters.query) conditions.push(getMessageTextSearchCondition(filters.query));
	if (filters.title) conditions.push(getMessageTitleSearchCondition(filters.title));
	if (filters.sender) conditions.push(getMessageSenderSearchCondition(filters.sender));
	if (filters.recipient) conditions.push(getMessageRecipientSearchCondition(filters.recipient));
	if (filters.hasAttachments !== undefined) {
		conditions.push(getMessageAttachmentCondition(filters.hasAttachments));
	}
	if (filters.after) conditions.push(gte(messages.createdAt, filters.after));
	if (filters.before) conditions.push(lte(messages.createdAt, filters.before));
	return conditions;
}

function getFtsCondition(matchQuery: string): SQL {
	return sql`${messages.id} IN (
		SELECT message_id FROM message_search
		WHERE message_search MATCH ${matchQuery}
	)`;
}
