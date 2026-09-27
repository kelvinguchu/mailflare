# Indexed message search

CC Mail searches messages through the D1/SQLite FTS5 trigram index. User input is always
passed as a bound, quoted FTS phrase; clients cannot introduce FTS operators or column
selectors.

## Indexed content

- Sender and recipient addresses
- Subject and stored snippet
- Full plain-text and HTML bodies
- Attachment filenames

Binary attachment contents are not indexed. Extracting arbitrary document formats in the mail
request path would increase compute, storage, write latency, and parser attack surface. A future
asynchronous, sandboxed extraction pipeline can add that capability without changing the search
API.

## API filters

`GET /api/messages` accepts these search filters in addition to the existing mailbox, folder,
status, read, and view filters:

| Parameter        | Meaning                          | Bound             |
| ---------------- | -------------------------------- | ----------------- |
| `q`              | Phrase across all indexed fields | 3–200 characters  |
| `title`          | Subject phrase                   | 3–200 characters  |
| `from`           | Sender phrase                    | 3–320 characters  |
| `to`             | Recipient phrase                 | 3–320 characters  |
| `hasAttachments` | `true` or `false`                | One value         |
| `after`          | Inclusive ISO date or timestamp  | One value         |
| `before`         | Inclusive ISO date or timestamp  | One value         |
| `limit`          | Result page size                 | 1–100; default 50 |
| `offset`         | Result offset                    | 0–10,000          |

A date-only boundary uses UTC: `after` starts at 00:00:00.000 and `before` ends at
23:59:59.999. Duplicate, malformed, reversed, or out-of-range parameters return HTTP 400.

Mailbox authorization is composed into every message query before search filters are applied.
Requesting a mailbox outside the authenticated user's accessible mailbox set returns HTTP 404.

## Index maintenance

Message insert, update, and delete triggers keep the FTS row synchronized. Attachment insert,
rename, reassignment, and delete triggers refresh the indexed filename list. Migration 0042
rebuilds and optimizes the index for existing messages.

## Performance verification

The integration suite checks the SQLite query plan for the FTS virtual-table index and runs a
multi-year fixture benchmark. On 2026-09-14, the local Workers runtime returned the unique match
from 20,000 messages spanning about 5.5 years in 26.0 ms. The fixture and measured duration remain
visible in test output, but correctness does not rely on a flaky wall-clock assertion.
