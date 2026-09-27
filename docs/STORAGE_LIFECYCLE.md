# Storage lifecycle

CC Mail applies the following server-side retention policy during the daily scheduled Worker run:

| Data                                             |                                  Retention | Behavior                                                                                                                                              |
| ------------------------------------------------ | -----------------------------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Messages in trash                                | 30 days from the most recent move to trash | Raw email and attachment objects are deleted from R2 before the message is deleted from D1. Moving a message out of trash clears its retention clock. |
| Audit logs                                       |                                   365 days | Expired rows are deleted from D1.                                                                                                                     |
| Webhook deliveries                               |                                    30 days | Delivery history and stored payloads are deleted from D1.                                                                                             |
| Replayed dead-letter events                      |              30 days after the last update | Expired rows are deleted from D1.                                                                                                                     |
| Unresolved or stuck replaying dead-letter events |                      180 days from capture | Expired rows are deleted from D1; any now-unreferenced inbound source is removed by the orphan scan.                                                  |
| Failed or cancelled outbound jobs                |              90 days after the last update | Expired job rows and their stored payloads are deleted from D1.                                                                                       |
| Completed storage-deletion jobs                  |                   30 days after completion | The operational record is deleted after the audit trail has been retained separately.                                                                 |

Existing trash receives a new 30-day clock when migration `0044_add_storage_lifecycle.sql` is applied. This prevents rollout from immediately deleting messages that were already in trash.

## Explicit permanent deletion

`DELETE /api/messages/:messageId` permanently deletes one message. It is available only to the mailbox owner or a delegate with `full_access`, only while the message is in trash, and requires this JSON body:

```json
{ "confirmation": "permanently-delete" }
```

The endpoint returns `200` when deletion completes synchronously. It returns `202` with a deletion job ID when the operation was accepted but an R2 or D1 step must be retried. Deleting a draft uses the same failure-safe lifecycle internally but retains the existing draft endpoint contract.

## Failure safety

Before deleting anything, CC Mail stores a durable job containing every raw-email and attachment key. R2 is deleted first; D1 message metadata is removed only after R2 succeeds. R2 deletion is idempotent, so a crash or partial failure is safe to retry. Failed jobs record an error code, attempt count, and next-attempt time and are retried with exponential backoff by the daily Worker run. Processing jobs abandoned for more than 15 minutes are reclaimed.

The audit log records both the request and completion using deterministic IDs so a retry cannot create duplicate completion records. Logs contain the message and deletion job identifiers but not message bodies or recipient content.

## Orphan cleanup

Each daily run scans one paginated R2 page for every application-owned prefix: inbound sources, attachments, signature assets, account avatars, mailbox avatars, and branding. Objects younger than 24 hours are protected so an upload that is still being committed is not mistaken for an orphan. Older objects are removed only when no corresponding D1 reference exists. Backup objects are excluded because the backup subsystem owns their retention and manifest integrity.
