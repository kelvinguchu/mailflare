import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { messages } from "@/db/schema";
import { getContainsPattern } from "@/lib/messages/search";

export function getMessageTextSearchCondition(query: string): SQL {
	const pattern = getContainsPattern(query);
	return sql`${messages.id} IN (
		SELECT message_id FROM message_search
		WHERE search_text LIKE ${pattern} ESCAPE '\\'
	)`;
}

export function getMessageTitleSearchCondition(title: string): SQL {
	const pattern = getContainsPattern(title);
	return sql`${messages.id} IN (
		SELECT message_id FROM message_search
		WHERE subject LIKE ${pattern} ESCAPE '\\'
	)`;
}
