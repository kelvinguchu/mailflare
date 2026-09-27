# To and Cc recipient semantics

CC Mail stores visible recipients explicitly on every message:

- `messages.to_addr` is the normalized visible `To` header.
- `messages.cc_addr` is the normalized visible `Cc` header and defaults to an empty string.
- `messages.delivered_to_addr` is the inbound SMTP envelope recipient. It is separate from the visible headers and is used to identify the local mailbox for replies and authorization-sensitive routing.

Migration `0047_add_cc_recipient_semantics.sql` adds the fields, backfills the delivery address for existing inbound messages, and rebuilds the FTS recipient projection so recipient searches include both To and Cc.

## Normalization and limits

Outbound sends require at least one valid To address. To and Cc accept RFC-style mailbox lists and display names. Before a message is queued, CC Mail:

1. parses every mailbox;
2. lowercases the address while preserving a safely quoted display name;
3. removes duplicates case-insensitively within and across fields, with To taking precedence;
4. rejects invalid or overlong addresses; and
5. enforces Cloudflare Email Service's combined limit of 50 To and Cc recipients.

The composer exposes the same model as removable address chips. Enter, comma, semicolon, or Tab commits an address; Backspace removes the last chip when the input is empty. The Cc row is collapsed until requested or until a saved draft/reply already contains Cc recipients.

## Delivery and retry safety

The normalized To and Cc headers are persisted before the outbound job is reserved. The idempotency fingerprint covers both normalized fields. Queue consumers reconstruct the provider recipient arrays from the persisted message, not from mutable UI input or queue payload data. A retry therefore cannot replace, add, or duplicate recipients.

Cloudflare's structured email builder receives separate `to` and `cc` arrays, so the generated MIME headers match the visible recipient roles. Suppression checks and contact upserts cover every normalized recipient before queueing. Provider suppression only auto-blocks a contact when the send had one recipient, because a multi-recipient provider error does not identify which address failed.

## Inbound, replies, forwards, and exports

Inbound MIME parsing preserves every To and Cc mailbox. The Email Routing envelope recipient remains authoritative for mailbox selection, inbox rules, and automatic replies; a forged visible header cannot select another mailbox. Reply-all targets the original sender and retains other visible To/Cc recipients while excluding the sender and the delivered local mailbox. Forwarded text includes the original To and Cc headers.

Draft autosave, Undo Send restoration, message detail, conversation views, webhooks, Mbox exports, and indexed search all carry Cc. Database backup format version 11 preserves the new columns. Version 10 and older restores remain supported: missing `cc_addr` values use the empty default and missing delivery addresses remain nullable.

## Verification

Automated coverage includes recipient parsing and deduplication, MIME To/Cc parsing, API propagation, draft and composer contracts, reply-all/forward behavior, indexed Cc search, immutable queue retries, migration parity, and backup round trips/backward restore compatibility.

The isolated 0047 release was deployed on September 15, 2026:

- staging Worker version `1217d190-8f06-4287-ad3c-fa0a50d00726`;
- production Worker version `b0f1b07b-8810-4659-ad12-abbc2736791a`.

Post-deploy checks confirmed HTTP 200 responses for login and compose, the recorded 0047 migration, the expected column constraints/defaults, Cc-aware search triggers, and no pending production migrations.
