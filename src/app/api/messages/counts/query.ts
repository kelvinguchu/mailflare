import type { MessageCountAggregateRow } from "./types";

export type MessageCountScope =
	{ mailboxId: string } | { accessibleMailboxIds: string[] } | { userId: string };

export async function queryMessageCountAggregates(
	database: D1Database,
	scope: MessageCountScope,
	threadView: boolean,
): Promise<MessageCountAggregateRow[]> {
	let filterSql: string;
	let bindings: string[];
	if ("mailboxId" in scope) {
		filterSql = "mailbox_id = ?";
		bindings = [scope.mailboxId];
	} else if ("accessibleMailboxIds" in scope) {
		if (scope.accessibleMailboxIds.length === 0) return [];
		filterSql = `mailbox_id IN (${scope.accessibleMailboxIds.map(() => "?").join(", ")})`;
		bindings = scope.accessibleMailboxIds;
	} else {
		filterSql = "user_id = ?";
		bindings = [scope.userId];
	}

	const unreadAggregate = threadView
		? "COUNT(DISTINCT CASE WHEN is_unread = 1 THEN thread_key END)"
		: "COALESCE(SUM(is_unread), 0)";
	const query = `
		WITH filtered AS (
			SELECT
				mailbox_id,
				folder_id,
				status,
				direction,
				read,
				starred,
				snoozed_until,
				coalesce(mailbox_id, 'unassigned') || ':' || coalesce(thread_id, id) AS thread_key
			FROM messages
			WHERE ${filterSql}
		), classified AS (
			SELECT
				*,
				CASE WHEN direction = 'inbound' AND read = 0 THEN 1 ELSE 0 END AS is_unread,
				CASE
					WHEN snoozed_until IS NOT NULL AND snoozed_until > unixepoch() THEN 'snoozed'
					WHEN status = 'trash' THEN 'trash'
					WHEN status = 'spam' THEN 'spam'
					WHEN status = 'archived' THEN 'archived'
					WHEN direction = 'inbound' AND status = 'received' AND folder_id IS NULL THEN 'inbox'
					WHEN direction = 'outbound' AND status = 'sent' THEN 'sent'
					WHEN direction = 'outbound' AND status = 'draft' THEN 'drafts'
				END AS folder_key
			FROM filtered
		)
		SELECT 'folder' AS scope, folder_key AS key, COUNT(*) AS total,
			${unreadAggregate} AS unread, 0 AS inbox
		FROM classified WHERE folder_key IS NOT NULL GROUP BY folder_key
		UNION ALL
		SELECT 'folder', 'starred', COUNT(*), ${unreadAggregate}, 0
		FROM classified WHERE starred = 1
		UNION ALL
		SELECT 'custom', folder_id, COUNT(*), ${unreadAggregate}, 0
		FROM classified WHERE folder_id IS NOT NULL GROUP BY folder_id
		UNION ALL
		SELECT 'mailbox', mailbox_id, COUNT(*), ${unreadAggregate},
			COALESCE(SUM(CASE WHEN folder_key = 'inbox' THEN 1 ELSE 0 END), 0)
		FROM classified WHERE mailbox_id IS NOT NULL GROUP BY mailbox_id
	`;
	const result = await database
		.prepare(query)
		.bind(...bindings)
		.all<MessageCountAggregateRow>();
	return result.results;
}
