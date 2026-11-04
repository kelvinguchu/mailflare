# Team inbox inspection and retained deletion

Implemented 15 October 2026. The Team’s inbox uses the existing inbox list rows and expanded conversation reader. Messages appear first; the ordinary search bar searches team mail. Mailbox and folder selectors sit in the toolbar, advanced filters open from the filter icon, and deletion states use small badges. There is no inspection introduction banner or separate directory panel.

## Access and behavior

- Production inspector: `mohamed@calibercode.io`; local inspector: `admin@example.com`. The database email, trusted deployment environment, account activation, disabled-account checks and existing MFA restrictions apply on the server. Other administrators have no inspection capability.
- Inspection has dedicated private/no-store endpoints under `/api/team-inboxes`, separate attachment URLs and separate client state. It does not grant send-as access, mark mail read, modify drafts or enable external tracking images.
- Personal/shared mailboxes, including inactive accounts, can be selected from the toolbar. Deleted mail remains searchable in its known original placement and in Deleted. Historical information that was never recorded is explicitly unavailable.
- First Delete moves to Trash. Delete from Trash and 30-day expiry hide employee mail while retaining bodies, attachments and attribution. Restoration preserves deletion history. Ordinary lists, search, conversations, counts, exports and attachment access exclude hidden records.
- Draft autosave stores the latest saved text and validated attachments in private R2. Concurrent saves use revisions; discarded drafts cannot be resurrected. Failed uploads leave the previous saved state intact. Browser recovery remains available. Unsaved device-only content is unavailable to inspection.
- Accepted outbound jobs store a content fingerprint. Draft consumption requires the entire saved content, recipients and attachment bytes to match that accepted snapshot; it cannot hide unrelated unsent content. Sending does not create a discarded-draft entry.
- Physical removal is restricted to the inspector, hidden messages, recent authentication and typed `permanently-delete-retained-message` confirmation. Explicit authorization is recorded before retryable D1/R2 cleanup.
- Deletion events live as long as retained messages. Access/removal audit records use the existing 365-day audit policy. Retained mail has no automatic expiry. Previously physically deleted mail cannot be recovered.
- Refresh is explicit and every 60 seconds while the page is visible. No new Durable Objects or per-mailbox background jobs were added.

## Local validation

Existing accounts/data are preserved. Local-only idempotent seed fixtures include:

| Account | Role/state |
| --- | --- |
| `alice.demo@example.com` | Employee |
| `ben.demo@example.com` | Other administrator |
| `casey.demo@example.com` | Disabled, archived employee |

New synthetic accounts use `team-demo-password`. A synthetic shared mailbox, Inbox/Sent/Drafts/Trash/deleted mail and a text attachment are included. `POST /api/seed` only operates in local development. Existing local owner credentials are unchanged.

Validation: 268 unit tests, 86 integration tests using isolated D1/R2, 40 local authenticated HTTP checks, attachment runtime checks, production/development dependency audit, environment isolation, formatting, source/integration TypeScript and ESLint. Desktop (1440px) and mobile (390px) owner/employee sessions verified the existing inbox design, message opening, collapsed filters, denied employee inspection, draft attachment save, failure/retry state and no horizontal overflow. No production test emails or employee actions were performed.

## Release and recovery

Migration `0050_add_team_inbox_retention.sql` updates migrations, fresh-install schema, indexes and backup format v13 together. Original attribution is recorded on insert and preserved across transfers. Older backups remain accepted.

The schema-compatible deletion hold was deployed first as Worker version `4dc25ae0-5c7c-49cf-a356-66a1af6392a6`. Inbound processing and reminders continued. Pre-migration Time Travel bookmark: `000006b6-00000000-00005105-b03b8710ecefeca5848b9b02a9342250`.

Production preflight: one active designated inspector; 286 messages, 203 raw-object references, 141 attachments; 22 completed deletion jobs and no pending jobs. Migration 0050 was then applied under the hold. Post-migration verification: 286 messages and all 141 attachment records preserved, attribution populated for every message, 12 historical Trash events recorded, and no pending deletion jobs to reconcile.

Final production Worker version: `e35af8fc-fc9d-4f78-8b93-1d67937c7721`, deployed at 100% on 15 October 2026. The retention hold is released in the complete implementation. Packaged Worker runtime passed before deployment. Live sign-in, setup/database connectivity, protected APIs, static assets and CSP passed; all inspected Team API routes return private/no-store 401 responses without authentication. The deployed Team page asset matches the verified build byte for byte. The public `calibercode.io` website also returns HTTP 200. Production verification used read-only requests. Live scheduled execution and observed fetches completed with no exceptions or error logs.

If application rollback is necessary, use the schema-compatible hold version above to preserve retained mail. Do not roll back to an older version that physically purges employee mail. Database recovery requires assessing mail received since the bookmark before restoring.


### Dropdown and state badge follow-up

Mailbox trigger sizing now measures the actual addresses, and its popup fits the widest option, including inactive labels. Popups stay inside the viewport; selected addresses wrap when a narrow screen cannot fit them on one line. Deleted is red, Trash amber, Draft blue, and deletion history violet; the same state badge is used in the list and deletion details.

Before release, the open dropdown was visually checked at 1440px and 390px, including the full inactive label. A longer synthetic address (`mohamed.ahmed.cagabiyo@calibercode.io`) was injected only into the isolated local browser response: no option clipped, the selected value wrapped fully on mobile, and the document had no horizontal overflow. TypeScript, targeted ESLint, formatting and packaged Worker runtime checks cover this presentation-only follow-up.

Follow-up deployed at 100% as `f2edbadc-401d-4ebb-9e9e-b1225d145754` on 15 October 2026. Production HTTP, database setup, protected Team endpoints, static assets and CSP checks passed; the new Team page asset matches the verified build. No migration was required.
