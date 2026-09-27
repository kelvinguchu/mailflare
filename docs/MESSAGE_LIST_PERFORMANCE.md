# Message-list performance

Implemented and deployed on 2026-09-15 as migration
`0043_improve_message_list_performance.sql`.

## Runtime behavior

- The dashboard uses opaque keyset cursors ordered by `(created_at DESC, id DESC)` for message
  lists and `(last_message_at DESC, thread_key DESC)` for conversation lists.
- The first cursor page fixes a snapshot timestamp. Later pages reuse that timestamp, so a newly
  delivered message cannot shift the active result set and cause a skip or duplicate.
- The API returns `nextCursor` only when another page exists. `total` is computed on the first
  cursor page and retained by the client instead of being recomputed on every page.
- Bounded offset pagination remains available for older API clients, but the product interface no
  longer uses it.
- Message counts are grouped in one D1 query. The Worker receives aggregate folder, custom-folder,
  and mailbox rows rather than every message in the selected scope.

## Indexes

The migration adds these indexes for the actual list predicates:

- `messages_mailbox_status_created_id_idx`
- `messages_mailbox_folder_created_id_idx`
- `messages_mailbox_read_created_id_idx`
- `messages_mailbox_starred_created_id_idx`
- `messages_mailbox_snoozed_created_id_idx`
- `messages_mailbox_thread_key_created_id_idx`

The final index uses `coalesce(thread_id, id)` so unthreaded messages and conversations share the
same stable grouping key. `PRAGMA optimize` runs after index creation, as recommended in the
[Cloudflare D1 index guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/).
These indexes intentionally trade a small amount of storage and write maintenance for bounded
mailbox navigation. Staging database size increased by 24,576 bytes with the current small dataset.

## Query-plan comparison

Plans were captured against the remote staging D1 database immediately before and after migration
0043 using `EXPLAIN QUERY PLAN`.

| Query | Before | After |
| --- | --- | --- |
| Inbox | mailbox/provider index plus temporary order B-tree | mailbox/folder/date covering order; no temporary sort |
| Custom folder | mailbox/provider index plus temporary order B-tree | mailbox/folder/date covering index; no temporary sort |
| Unread | mailbox/provider index plus temporary order B-tree | mailbox/read/date covering index; no temporary sort |
| Status folder | not separately indexed | mailbox/status/date covering index; no temporary sort |
| Conversation list | mailbox/provider index plus temporary group and order B-trees | mailbox/thread-expression index; only aggregate order B-tree remains |

The post-migration plans are asserted by
`tests/integration/message-list-performance.test.ts`, preventing an unnoticed index regression.

## Reproducible load test

Run:

```text
npx vitest run --config vitest.integration.config.mts tests/integration/message-list-performance.test.ts --reporter=verbose --disableConsoleIntercept
```

The test creates 5,000 messages across two mailboxes and measures thread-view counts, two cursor
pages, inbox navigation, and switching counts between both mailboxes. Result from the deployed
build validation environment:

| Operation | Measured time |
| --- | ---: |
| Thread-view counts across both mailboxes | 16 ms |
| Two 25-conversation cursor pages | 55 ms |
| One 26-row inbox page | 2 ms |
| Counts for two consecutive mailbox switches | 17 ms |

The thresholds are deliberately looser than these measurements so ordinary CI host variation does
not create flaky failures.

## Deployment record

- Staging Worker version: `17fe4897-24fd-4328-8fc7-9341702bff90`
- Production Worker version: `f589ed47-5544-46d5-89af-1bff9cdc95e2`
- Production pre-migration Time Travel bookmark:
  `000001e3-00000004-000050e6-f6b3708284834bd76352090bb01b2bc5`
- Production row verification after migration: 24 messages, unchanged from before migration.
- Both environments report no pending D1 migrations.
