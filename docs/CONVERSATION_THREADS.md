# Conversation threads backend

This document is the contract between the conversation UI and the backend. It was implemented on 2026-09-14 by migration `0039_add_conversation_threads.sql` and the message, draft, send, import and inbound APIs.

## Implementation status

- Inbound delivery, imports, drafts, outbound sends and auto-replies share one thread-assignment implementation.
- Thread list, conversation detail, unread counts and thread-scoped bulk actions are live.
- The temporary single-message frontend fallbacks have been removed.

## Data model

Add to `messages` (drafts are `messages` rows too):

| Column                | Purpose                                                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `thread_id`           | Opaque id `thr_…`, scoped to one mailbox. Required for every non-draft row once backfilled.                 |
| `provider_message_id` | RFC 5322 `Message-ID` including angle brackets. Generated for outbound as `<{message.id}@{sender domain}>`. |
| `in_reply_to`         | Parsed `In-Reply-To` Message-ID, or the parent's id for our own replies.                                    |
| `references`          | JSON array of Message-IDs, oldest first, capped at the last 20.                                             |
| `reply_to_message_id` | Internal id of the parent message for drafts and sent replies. `ON DELETE SET NULL`.                        |

Indexes: `(mailbox_id, thread_id, created_at)` and `(mailbox_id, provider_message_id)`.

The thread id is not the `Message-ID` itself because Message-IDs can be missing, duplicated across mailboxes, or forged.

## Thread assignment

Inbound delivery, import, and auto-replies assign a thread inside the same mailbox, in this order:

1. The message whose `provider_message_id` equals `In-Reply-To`.
2. The newest message whose `provider_message_id` appears in `References`, checked from last to first.
3. Fallback for clients that drop headers: a message from the last 30 days with the same normalized subject (strip repeated `Re:`, `Fwd:`, `Fw:`, `AW:`, `SV:` prefixes, collapse whitespace, case-insensitive) where the new sender appears in the candidate's `from` or `to`. Never apply the fallback to an empty normalized subject.
4. Otherwise a new thread.

Assignment must be deterministic under concurrent deliveries. Two replies to the same parent always join the parent's thread. The inbound idempotency path must preserve the first assignment on duplicate delivery.

Outbound:

- `POST /api/send` and drafts accept an optional `replyToMessageId` (JSON field or multipart form field). The server verifies the parent is readable by the user and in the same mailbox as the sender; otherwise respond `400`.
- A reply copies the parent's `thread_id`, sets `In-Reply-To` to the parent's `provider_message_id`, and sets `References` to the parent's references plus the parent's Message-ID.
- A message without `replyToMessageId` starts a new thread. Forwarding is intentionally a new thread.
- `replyToMessageId` is part of the outbound idempotency request hash.

Migration: backfill in `created_at` order with the same algorithm, generating `provider_message_id` for existing outbound rows that lack one.

## APIs

### Thread list: `GET /api/messages?view=threads`

All existing filters keep their meaning. With `view=threads`:

- Return one row per thread that has at least one message matching the folder filters. `total` counts threads.
- The row is a normal message object for the newest message in that thread, excluding drafts and excluding trash and spam unless the folder is trash or spam. Links, stars, and selection keep using the row's message `id`, so a reply you sent moves the conversation to the top of the Inbox.
- `read` is `true` only when the thread has no unread inbound messages. `starred` is `true` when any message is starred.
- `q`, `title`, and `read=unread` match threads where any message matches.
- Drafts (`status=draft`) ignore `view=threads`.

Each row adds:

```ts
thread: {
	id: string;
	/** Messages shown in the conversation view. */
	messageCount: number;
	/** Unread inbound messages. */
	unreadCount: number;
	hasAttachments: boolean;
	lastMessageAt: string;
	/** Deduplicated by address, ordered by each participant's first message. */
	participants: Array<{
		name: string;
		address: string;
		/** The address belongs to the viewed mailbox. */
		isMe: boolean;
		/** This participant sent at least one unread message. */
		unread: boolean;
	}>;
}
```

`participants` includes senders only, matching Gmail. A thread consisting only of your own outbound messages lists its recipients instead, so Sent rows read `To: Maya`.

### Conversation: `GET /api/messages/:messageId/thread`

```ts
{
	thread: {
		id: string;
		subject: string | null;
		messages: Array<Message & { hasAttachments: boolean }>;
	}
}
```

- `messages` is ordered oldest first and uses the list's message shape without bodies. The UI loads bodies through `GET /api/messages/:messageId`.
- Exclude drafts. Exclude trash and spam messages unless `:messageId` itself is in trash or spam.
- Scope to mailboxes the user can read. Respond `404` with `{ "error": "Not found" }` when `:messageId` is not readable.
- A message without a thread returns a thread containing only itself.

### Thread-scoped actions: `POST /api/messages/bulk`

Accept `scope: "message" | "thread"` (default `message`). With `thread`, expand `messageIds` to every readable message in their threads before applying:

| Action                               | Thread behavior                                                  |
| ------------------------------------ | ---------------------------------------------------------------- |
| `read`                               | Mark every unread inbound message read.                          |
| `unread`                             | Mark only the newest inbound message unread.                     |
| `archive`, `spam`, `inbox`, `folder` | Move inbound messages; outbound messages keep their sent status. |
| `trash`                              | Move every message, inbound and outbound.                        |

Access checks stay per message. Audit one entry per thread.

### Counts: `GET /api/messages/counts?view=threads`

Folder `unread` counts threads with at least one unread message. Without `view=threads` counts are unchanged.

## Tests

- Header parsing for `In-Reply-To` and `References`, including folded headers and missing angle brackets.
- Assignment order, the subject fallback's 30-day window and participant requirement, and cross-mailbox isolation.
- Concurrent replies and duplicate inbound delivery converging on one thread.
- Reply sends producing correct headers and inheriting `thread_id`, and `replyToMessageId` affecting the idempotency hash.
- Thread list pagination, unread filtering, and newest-message selection per folder.
- Thread-scoped bulk actions, including outbound messages keeping sent status on archive.
- Backfill producing the same threads as live assignment.

## UI integration

Non-draft message lists request `view=threads`, conversation views use the thread route, and realtime arrivals replace their existing conversation row before the reconciliation fetch.
