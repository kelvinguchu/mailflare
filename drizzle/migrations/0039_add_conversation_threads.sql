ALTER TABLE messages ADD COLUMN in_reply_to text;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN "references" text;
--> statement-breakpoint
ALTER TABLE messages ADD COLUMN reply_to_message_id text REFERENCES messages(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX messages_mailbox_thread_created_idx
	ON messages (mailbox_id, thread_id, created_at);
--> statement-breakpoint
CREATE INDEX messages_mailbox_provider_message_idx
	ON messages (mailbox_id, provider_message_id);
--> statement-breakpoint

-- Normalize existing RFC Message-IDs. Cloudflare controls the final outbound
-- Message-ID, but queued historical rows still need a stable local identifier.
UPDATE messages
SET provider_message_id = NULL
WHERE provider_message_id IS NOT NULL
	AND instr(trim(provider_message_id, '<> '), '@') = 0;
--> statement-breakpoint
UPDATE messages
SET provider_message_id = '<' || trim(provider_message_id, '<> ') || '>'
WHERE provider_message_id IS NOT NULL
	AND trim(provider_message_id) <> '';
--> statement-breakpoint
UPDATE messages
SET provider_message_id = '<' || id || '@' ||
	CASE
		WHEN instr(from_addr, '@') > 0
			THEN lower(trim(rtrim(substr(from_addr, instr(from_addr, '@') + 1), '> ')))
		ELSE 'mailflare.local'
	END || '>'
WHERE direction = 'outbound'
	AND (provider_message_id IS NULL OR trim(provider_message_id) = '');
--> statement-breakpoint
UPDATE messages SET "references" = '[]' WHERE status <> 'draft';
--> statement-breakpoint

-- Before this migration no reply headers were persisted, so historical
-- backfill uses the live algorithm's subject/participant fallback. The
-- recursive normalization strips every recognized reply/forward prefix.
CREATE TABLE message_thread_backfill (
	message_id text PRIMARY KEY,
	created_at integer NOT NULL,
	from_address text NOT NULL,
	normalized_subject text NOT NULL,
	parent_id text
);
--> statement-breakpoint
WITH RECURSIVE normalized(message_id, value) AS (
	SELECT id, lower(trim(replace(replace(replace(replace(subject, char(9), ' '), '  ', ' '), '  ', ' '), '  ', ' ')))
	FROM messages
	WHERE status <> 'draft'
	UNION ALL
	SELECT message_id,
		CASE
			WHEN instr(value, '  ') > 0 THEN replace(value, '  ', ' ')
			ELSE trim(substr(value, instr(value, ':') + 1))
		END
	FROM normalized
	WHERE instr(value, '  ') > 0
		OR value GLOB 're:*'
		OR value GLOB 're :*'
		OR value GLOB 'fwd:*'
		OR value GLOB 'fwd :*'
		OR value GLOB 'fw:*'
		OR value GLOB 'fw :*'
		OR value GLOB 'aw:*'
		OR value GLOB 'aw :*'
		OR value GLOB 'sv:*'
		OR value GLOB 'sv :*'
), final_subject AS (
	SELECT n.message_id, n.value
	FROM normalized n
	WHERE NOT (
		instr(n.value, '  ') > 0
		OR n.value GLOB 're:*'
		OR n.value GLOB 're :*'
		OR n.value GLOB 'fwd:*'
		OR n.value GLOB 'fwd :*'
		OR n.value GLOB 'fw:*'
		OR n.value GLOB 'fw :*'
		OR n.value GLOB 'aw:*'
		OR n.value GLOB 'aw :*'
		OR n.value GLOB 'sv:*'
		OR n.value GLOB 'sv :*'
	)
)
INSERT INTO message_thread_backfill (message_id, created_at, from_address, normalized_subject)
SELECT
	m.id,
	m.created_at,
	lower(trim(CASE
		WHEN instr(m.from_addr, '<') > 0 AND instr(m.from_addr, '>') > instr(m.from_addr, '<')
			THEN substr(m.from_addr, instr(m.from_addr, '<') + 1, instr(m.from_addr, '>') - instr(m.from_addr, '<') - 1)
		ELSE m.from_addr
	END)),
	coalesce(f.value, '')
FROM messages m
LEFT JOIN final_subject f ON f.message_id = m.id
WHERE m.status <> 'draft';
--> statement-breakpoint
UPDATE message_thread_backfill AS current
SET parent_id = (
	SELECT candidate.message_id
	FROM message_thread_backfill candidate
	JOIN messages candidate_message ON candidate_message.id = candidate.message_id
	JOIN messages current_message ON current_message.id = current.message_id
	WHERE candidate_message.mailbox_id = current_message.mailbox_id
		AND current.normalized_subject <> ''
		AND candidate.normalized_subject = current.normalized_subject
		AND (
			candidate.created_at < current.created_at
			OR (candidate.created_at = current.created_at AND candidate.message_id < current.message_id)
		)
		AND candidate.created_at >= current.created_at - 2592000
		AND (
			lower(candidate_message.from_addr) LIKE '%' || current.from_address || '%'
			OR lower(candidate_message.to_addr) LIKE '%' || current.from_address || '%'
		)
	ORDER BY candidate.created_at DESC, candidate.message_id DESC
	LIMIT 1
);
--> statement-breakpoint
WITH RECURSIVE roots(message_id, root_id) AS (
	SELECT message_id, message_id
	FROM message_thread_backfill
	WHERE parent_id IS NULL
	UNION ALL
	SELECT child.message_id, roots.root_id
	FROM message_thread_backfill child
	JOIN roots ON roots.message_id = child.parent_id
)
UPDATE messages
SET thread_id = 'thr_' || (
	SELECT root_id FROM roots WHERE roots.message_id = messages.id
)
WHERE status <> 'draft';
--> statement-breakpoint
DROP TABLE message_thread_backfill;
