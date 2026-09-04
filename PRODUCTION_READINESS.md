# CC Mail Production Readiness

This is the working checklist for taking CC Mail from a functional beta to a dependable internal business mail client.

Audit date: 2026-09-01

Production: `https://mail.calibercode.io`

Last reviewed deployment: `bf4c78ce-f6b8-40bd-990e-19f331cdabcc`

## How we will use this file

- Work from the top downward unless an active production incident changes the priority.
- Complete one bounded item at a time.
- Do not mark an item complete until its acceptance criteria pass.
- Add migrations instead of editing already-applied migrations.
- Test deployment changes in an isolated build directory; do not stop or replace the existing local development server.
- Record material decisions and completed work in the logs at the bottom.

Status:

- `[ ]` Not started
- `[-]` In progress
- `[x]` Complete and verified
- `[!]` Blocked or requires a decision

## Phase 0 — Protect the current work

### 0.1 Create a recoverable source checkpoint

- [x] Review the current working tree and separate intentional CC Mail changes from generated or accidental files.
- [x] Confirm that no secrets are tracked.
- [x] Commit the current working application as a named baseline.
- [x] Push the baseline to a private remote or otherwise create an off-machine copy.
- [x] Tag the deployed baseline so its source can be matched to production.

Acceptance criteria:

- `git status` is understood and contains no unexplained changes.
- The exact currently deployed source can be restored from another machine.
- No `.dev.vars`, API token, password, session secret, or private backup is committed.

### 0.2 Establish safe deployment environments

- [ ] Define separate staging and production Workers.
- [ ] Give staging separate D1, R2, Queue, Durable Object, Workflow and email test resources.
- [ ] Document required variables, secrets and bindings.
- [ ] Ensure production cannot be targeted accidentally by the normal development command.

Acceptance criteria:

- A staging deployment cannot read, overwrite or send from production data.
- The same release can be promoted from staging to production without rebuilding different source.

## Phase 1 — Make backup and recovery real

### 1.1 Repair scheduled backup execution

- [x] Add a real scheduled trigger or another reliable scheduler.
- [x] Make the scheduled handler start `DatabaseBackupWorkflow` without duplicating an already-due backup.
- [x] Record success and failure in an observable location.
- [x] Add tests for daily, weekly and monthly due-date calculations.

Acceptance criteria:

- A scheduled backup runs without an administrator opening the application.
- Repeated scheduler invocations on the same due date create at most one backup.
- A failed scheduled run is visible to an administrator.

### 1.2 Include all D1 application data

- [x] Add `calendar_events` to the backup format.
- [x] Add `email_templates` to the backup format.
- [x] Add `auto_reply_deliveries` to the backup format.
- [x] Compare the backup table list automatically against the application schema.
- [x] Version the backup format so future schema changes remain restorable.

Acceptance criteria:

- Every persistent application table is either backed up or explicitly documented as disposable.
- A test fails when a new persistent table is added without a backup decision.

### 1.3 Back up R2 objects

Status: `[x]` Production backups now create independent object copies under each backup prefix and record them in a versioned manifest. Restore paths are unit-tested; the full staging restore drill remains tracked by 1.4.

- [x] Define whether backups copy objects or store a complete manifest with an independent R2 versioning strategy.
- [x] Preserve raw inbound `.eml` objects.
- [x] Preserve attachments.
- [x] Preserve profile, mailbox and branding images.
- [x] Verify object checksums or sizes during backup and restore.

Acceptance criteria:

- Restored messages retain their raw source, inline images and downloadable attachments.
- Restored account and branding images render correctly.

### 1.4 Make restoration failure-safe

Status: `[-]` Implementation is deployed; the staging restore drill remains blocked on Phase 0.2.

- [x] Validate backup structure, version, tables, columns and object availability before deleting live data.
- [x] Add a maximum restore upload size.
- [x] Restore into a temporary or isolated database first where practical.
- [x] Define a rollback path for partial restoration failure.
- [x] Invalidate or deliberately preserve sessions after restoration.

Acceptance criteria:

- [x] An invalid or incomplete backup cannot erase the current database.
- [x] An injected failure during restoration leaves a documented recovery path.
- [!] A full restore drill succeeds in staging. Pending the isolated staging resources from Phase 0.2.

## Phase 2 — Guarantee mail processing integrity

### 2.1 Make outbound sending genuinely asynchronous

Status: `[x]` Browser, API, calendar and auto-reply sends now persist one message/job, enqueue only the job reference and let the outbound consumer own provider delivery and final status.

- [x] Separate message creation from provider delivery.
- [x] Enqueue an outbound job instead of calling the provider synchronously from the API request.
- [x] Return a stable queued message ID to the browser and API client.
- [x] Make the queue consumer update the existing job rather than creating another message and job.
- [x] Define retryable versus permanent provider failures.

Acceptance criteria:

- Closing the browser or timing out the API request cannot create an ambiguous send.
- One compose submission creates one message and one delivery job.
- Job state progresses predictably through `queued`, `sent`, or `failed`.

### 2.2 Add outbound idempotency

Status: `[x]` Every send now has an account-scoped idempotency key and request fingerprint; D1 admits one job per key, the consumer atomically claims delivery once, and uncertain post-provider outcomes are never resent.

- [x] Accept or generate an idempotency key for each send request.
- [x] Enforce uniqueness in D1.
- [x] Make queue retries safe after a provider timeout.
- [x] Prevent duplicate calendar invitations and auto-replies.

Acceptance criteria:

- Replaying the same request or queue message cannot send a second email.
- Tests cover retry before delivery, timeout after delivery and permanent failure.

### 2.3 Add inbound idempotency

Status: `[x]` Inbound deliveries now use a SHA-256 identity derived from the normalized SMTP envelope and raw message bytes, with deterministic R2 keys and one atomic D1 message/attachment batch.

- [x] Derive a stable delivery identity from Cloudflare delivery metadata and/or message content.
- [x] Add an appropriate uniqueness constraint.
- [x] Make attachment storage resumable or safely repeatable.
- [x] Ensure notification or webhook failure does not duplicate the stored message.

Acceptance criteria:

- Retrying the same inbound queue event leaves exactly one message and one attachment set.
- Missing or malformed `Message-ID` headers do not break deduplication.

### 2.4 Add dead-letter handling and replay

- [ ] Configure dead-letter queues for inbound and outbound processing.
- [ ] Store enough diagnostic context without exposing email contents in logs.
- [ ] Add an admin view or controlled command to inspect and replay failed jobs.
- [ ] Alert on sustained queue failures.

Acceptance criteria:

- Exhausted messages are recoverable instead of silently disappearing.
- Replay is idempotent and auditable.

### 2.5 Make webhooks reliable

- [ ] Move webhook delivery off the request and mail-processing critical paths.
- [ ] Retry temporary failures with bounded exponential backoff.
- [ ] include a stable delivery ID and timestamp in the signed payload.
- [ ] Add manual redelivery and delivery history.
- [ ] Define retention for webhook delivery records.

Acceptance criteria:

- Temporary endpoint failure is retried automatically.
- Receiving systems can deduplicate deliveries.
- Webhook failure cannot make an otherwise successful email operation fail.

## Phase 3 — Complete account security and recovery

### 3.1 Implement secure password recovery

- [ ] Create short-lived, single-use reset tokens stored only as hashes.
- [ ] Send reset links only to the verified recovery address.
- [ ] Rate-limit requests by account and IP without revealing whether an account exists.
- [ ] Revoke reset tokens after use or password change.
- [ ] Record reset activity in the audit log.

Acceptance criteria:

- A user can recover access without administrator database intervention.
- Reset tokens expire, cannot be reused and never appear in D1 as plaintext.

### 3.2 Improve administrator-created account activation

- [ ] Replace reusable temporary passwords with an invite or one-time activation flow.
- [ ] Require a new password at first sign-in.
- [ ] Allow administrators to resend or revoke an invitation.
- [ ] Show invitation and activation status in Accounts.

Acceptance criteria:

- Administrators do not need to know a user's permanent password.
- An unused or revoked invitation cannot activate an account.

### 3.3 Add session management

- [ ] Revoke other sessions when a password changes or is reset.
- [ ] Add “sign out other sessions.”
- [ ] Let administrators revoke sessions for a compromised account.
- [ ] Periodically delete expired session rows.
- [ ] Display recent sign-in activity to the account owner.

Acceptance criteria:

- A stolen old session cannot remain valid after account recovery.
- Session revocation is immediate and tested.

### 3.4 Add stronger administrator authentication

- [ ] Add TOTP or WebAuthn/passkey MFA, beginning with administrator accounts.
- [ ] Generate and securely store recovery codes.
- [ ] Require recent authentication for high-risk actions.
- [ ] Consider Cloudflare Access as an additional outer gate for the internal deployment.

Acceptance criteria:

- Administrator compromise requires more than a reused password.
- Recovery does not require bypassing authentication in the database.

### 3.5 Harden email-content privacy

- [ ] Block remote images by default or load them through a privacy-preserving proxy.
- [ ] Add a per-message “Display remote images” action.
- [ ] Add security tests for the custom HTML sanitizer.
- [ ] Review whether the application CSP can remove `unsafe-eval` and reduce `unsafe-inline`.
- [ ] Test malicious HTML, CSS, links, SVG, data URLs and inline attachments.

Acceptance criteria:

- Merely opening an email does not notify a remote tracking server by default.
- The sanitizer has regression tests for known XSS techniques.

## Phase 4 — Build an automated safety net

### 4.1 Add mail-path integration tests

- [ ] Inbound routing and aliases.
- [ ] Inbound retry and deduplication.
- [ ] Outbound authorization and sender identity.
- [ ] Outbound queue retry and idempotency.
- [ ] Shared mailbox permissions.
- [ ] Attachment authorization and storage cleanup.
- [ ] Auto-reply loop prevention.
- [ ] Webhook signing and retries.

Acceptance criteria:

- Critical mail flows run against isolated D1, R2 and Queue-compatible test bindings.
- Tests prove both allowed and forbidden mailbox actions.

### 4.2 Add backup and migration tests

- [ ] Round-trip every supported table through export and restore.
- [ ] Test old backup-format compatibility.
- [ ] Test every migration against a copy of the preceding schema.
- [ ] Test restoration failure without corrupting the source database.

Acceptance criteria:

- A fresh database and an upgraded database produce the same expected schema.
- Backup restoration is continuously verified rather than assumed.

### 4.3 Add browser smoke tests

- [ ] Administrator sign-in and account creation.
- [ ] User activation, sign-in and password change.
- [ ] Compose, send, receive and open a message.
- [ ] Upload and download an attachment.
- [ ] Shared mailbox switching and permissions.

Acceptance criteria:

- The essential business flow passes in staging before production promotion.

### 4.4 Add CI quality gates

- [ ] Run type checking, lint, unit tests and integration tests on every change.
- [ ] Remove `typescript.ignoreBuildErrors` from the Next configuration.
- [ ] Build the Cloudflare bundle in CI.
- [ ] Scan dependencies and secrets.
- [ ] Require a successful staging deployment before production.

Acceptance criteria:

- Code with type errors, failing tests or detected secrets cannot be deployed.
- Production releases are traceable to a Git commit.

### 4.5 Resolve dependency advisories deliberately

- [ ] Investigate the current four moderate development dependency advisories.
- [ ] Upgrade or replace the affected Drizzle tooling without applying a blind forced downgrade.
- [ ] Verify migrations and local development after the change.

Acceptance criteria:

- `npm audit` has no unexplained findings.
- Fixes do not regress schema generation or migration behavior.

## Phase 5 — Deliverability and abuse controls

### 5.1 Add sending safeguards

- [ ] Add per-user and per-domain send-rate limits.
- [ ] Add daily volume limits and administrator overrides.
- [ ] Prevent disabled accounts and mailboxes from queued delivery.
- [ ] Audit limit changes and rejected sends.

Acceptance criteria:

- A compromised account cannot immediately exhaust domain reputation or provider limits.

### 5.2 Track delivery outcomes

- [ ] Record provider acceptance separately from final delivery where the provider supports it.
- [ ] Ingest bounce, rejection and complaint events where available.
- [ ] Surface failed recipients and retry state in Sent mail.
- [ ] Suppress repeated sending to known hard-bounce recipients.

Acceptance criteria:

- “Sent” has a documented meaning.
- Administrators can explain why a message failed and what action is required.

### 5.3 Add domain-health visibility

- [ ] Monitor SPF, DKIM and DMARC configuration.
- [ ] Display routing and sending readiness separately.
- [ ] Add actionable warnings for missing or changed DNS records.
- [ ] Document warm-up and reputation expectations.

Acceptance criteria:

- An administrator can identify DNS and authentication problems without opening several Cloudflare pages.

### 5.4 Add inbound abuse protection

- [ ] Define attachment type restrictions and executable handling.
- [ ] Add malware scanning or quarantine integration.
- [ ] Add spam scoring or an external filtering strategy.
- [ ] Add sender/domain block lists and administrator allow lists.

Acceptance criteria:

- Suspicious mail can be quarantined before a user opens its content or attachments.

## Phase 6 — Improve mail semantics and scale

### 6.1 Implement real conversation threading

- [ ] Parse and store `Message-ID`, `In-Reply-To` and `References` correctly.
- [ ] Compute a stable thread identity.
- [ ] Handle missing or malformed headers.
- [ ] Present conversations without relying on quoted-body heuristics alone.

Acceptance criteria:

- Replies from common mail providers group into the expected conversation.
- Unrelated messages do not merge merely because subjects match.

### 6.2 Improve search

- [ ] Define which fields and message bodies must be searchable.
- [ ] Replace broad SQL `LIKE` scans with an appropriate indexed search strategy.
- [ ] Add date, sender, recipient, attachment and mailbox filters.
- [ ] Escape and bound all queries.

Acceptance criteria:

- Search remains responsive with a representative multi-year mailbox dataset.

### 6.3 Improve message-list performance

- [ ] Add compound indexes for actual mailbox, status, folder, read and date query patterns.
- [ ] Replace deep offset pagination with cursor pagination.
- [ ] Measure D1 query plans before and after index changes.
- [ ] Load-test counts and mailbox switching.

Acceptance criteria:

- Inbox and folder navigation stay responsive as message counts grow.

### 6.4 Add storage lifecycle management

- [ ] Define trash retention and permanent deletion behavior.
- [ ] Delete associated R2 raw mail and attachment objects when data is permanently removed.
- [ ] Clean orphaned R2 objects after failed operations.
- [ ] Define audit-log, webhook-log and failed-job retention.

Acceptance criteria:

- D1 and R2 do not grow indefinitely from deleted or failed operations.
- Permanent deletion is explicit, auditable and complete.

## Phase 7 — Finish administrative operations

### 7.1 Complete account lifecycle controls

- [ ] Reset or re-invite an account.
- [ ] Revoke sessions.
- [ ] Transfer mailbox ownership.
- [ ] Archive or delete an account safely.
- [ ] Export an account's data.

### 7.2 Improve operational visibility

- [ ] Add queue and delivery health.
- [ ] Add recent failures with safe diagnostic details.
- [ ] Add storage usage and growth.
- [ ] Add backup freshness and last verified restore.
- [ ] Add domain and sender health.

### 7.3 Review accessibility and responsive behavior

- [ ] Complete keyboard navigation.
- [ ] Verify focus management and screen-reader labels.
- [ ] Test narrow desktop, tablet and mobile layouts.
- [ ] Check contrast, reduced motion and large text.

## Framework migration gate

Do not begin the TanStack Start migration until all of the following are true:

- [ ] Phase 0 is complete.
- [ ] Backup and restore have passed a staging recovery drill.
- [ ] Inbound and outbound processing are idempotent.
- [ ] Critical mail-path integration tests exist.
- [ ] Staging and CI are operational.
- [ ] The current application behavior is documented well enough to detect migration regressions.

The migration should then preserve behavior first and improve architecture second. Do not combine the framework migration with mail-delivery redesign in the same unverified change.

## Recommended immediate execution order

1. `0.1` — Create a recoverable source checkpoint.
2. `1.1` — Repair scheduled backup execution.
3. `1.2` — Include all D1 data in backups.
4. `1.4` — Make restore failure-safe.
5. `1.3` — Add R2 objects to the recovery plan.
6. `2.3` — Add inbound idempotency.
7. `2.1` — Make outbound sending genuinely asynchronous.
8. `2.2` — Add outbound idempotency.
9. `2.4` — Add dead-letter handling and replay.
10. `4.1` and `4.2` — Lock the repaired behavior in tests.

## Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-09-01 | Personal mailboxes use the owner account avatar; shared mailboxes retain their own avatar. | Avoid duplicate avatar state and inconsistent rendering. |
| 2026-09-01 | Reliability work precedes the TanStack Start migration. | Preserve a testable behavioral baseline and avoid migrating known delivery/recovery risks. |
| 2026-09-04 | `_cf_KV`, `d1_migrations`, and `sqlite_sequence` are classified as database-owned rather than application backup data. | Cloudflare D1, the migration runner, and SQLite recreate or manage these tables; restoring application rows must not overwrite their state. |
| 2026-09-04 | Outbound queue messages contain only a D1 job ID; provider delivery reads the durable message and R2 attachments in the consumer. | Keep queue payloads small, preserve a stable browser/API message ID and ensure one request creates one message and one job. |
| 2026-09-04 | An unclassified error after Email Service delivery begins is recorded as `E_DELIVERY_OUTCOME_UNKNOWN` and is not retried. | The current Email Service binding has no caller-supplied provider idempotency key and controls `Message-ID`; suppressing a possible email is safer than knowingly risking a duplicate. Explicit transient provider rejections remain retryable. |

## Progress log

| Date | Item | Result | Verification |
| --- | --- | --- | --- |
| 2026-09-01 | Initial production-readiness assessment | Checklist created; no readiness item marked complete yet. | Source review, `npm run typecheck`, `npm run lint`, existing six tests, and dependency audit. |
| 2026-09-01 | 0.1 — Recoverable source checkpoint | Reviewed customization committed and copied to a private GitHub repository. | Commit `8f4aaa9`; tag `cc-mail-baseline-2026-09-01`; private remote `kelvinguchu/cc-mail-calibercode`; real `.dev.vars` confirmed ignored; typecheck and six tests passed; lint completed with zero errors and 58 recorded warnings. |
| 2026-09-01 | 1.1 — Scheduled backup execution | Added a 02:00 UTC Cron Trigger, a scheduled Worker handler, UTC-date idempotency, structured logs, and administrator-visible failure records; enabled daily backups with 30-day retention. | Production version `4b9f94c6-7e9a-4f4c-aacb-911788cb38b4`; ten tests and typecheck passed; backup `bak_scheduled_2026-09-01` completed and wrote 15,767 bytes to R2; a repeated same-day invocation was skipped and D1 retained one scheduled record. |
| 2026-09-04 | 1.2 — Complete D1 backup coverage | Introduced backup format v2 with all 21 application tables, v1 normalization, schema and live-catalog drift guards, versioned filenames, and R2 format metadata. | Production version `7df1a716-20a3-49a7-b9ff-6b8e7fbad303`; 17 tests and typecheck passed; lint completed with zero errors and the same 58 warnings; Workflow `c0ed832b-6602-4783-a9df-5ffe03b14165` stored verified backup `bak_verify_v2_20260904` (17,211 bytes) in R2; production returned HTTP 200. |
| 2026-09-04 | 1.4 — Failure-safe restore implementation | Added a 10 MiB limit, format/schema/value/R2 preflight checks, isolated staging tables, a pre-restore R2 recovery snapshot, one atomic live D1 batch, deliberate global session invalidation, and a recovery runbook. The item remains in progress until the full staging drill can run. | Production version `bd89a829-e388-48b2-9780-6d1c3ed8edab`; 21 tests and typecheck passed; lint completed with zero errors and the same 58 warnings; isolated OpenNext build and Wrangler dry run passed; production returned HTTP 200. |
| 2026-09-04 | 1.3 — Independent R2 backup bundles | Added backup format v3 with per-backup copies of raw `.eml`, attachment, profile, mailbox and branding objects; size, ETag and available-checksum validation; whole-prefix retention/deletion; and R2 rollback from the pre-restore recovery bundle. Version 1 and 2 backups remain restorable through legacy live references. | Production version `fd6a1de2-dd9d-450d-bdbe-c38f54509c8a`; 27 tests, typecheck, lint, isolated OpenNext build and Wrangler dry run passed; Workflow `495d7fcb-dc6a-4be4-a78b-8c41f408dfc9` completed backup `bak_verify_v3_20260904` with a 27,561-byte manifest and five independent objects totaling 1,102,098 bytes; D1 recorded 1,129,659 bytes and production returned HTTP 200. No restore drill was run. |
| 2026-09-04 | 2.3 — Inbound idempotency | Added a content-derived delivery identity independent of `Message-ID`, a nullable unique D1 constraint, deterministic raw and attachment R2 keys, atomic message/attachment inserts, legacy queue-payload compatibility and post-commit notification/webhook isolation. | Pre-migration backup `bak_pre_idempotency_20260904` completed with six independent R2 objects; migration `0027_add_inbound_delivery_key.sql` applied successfully; production version `e8d47ad1-b17c-46cf-8d73-5d594b5a6976`; 32 tests, typecheck, lint, isolated OpenNext build and Wrangler dry run passed; production returned HTTP 200. Duplicate replay was verified deterministically in tests; no synthetic email was inserted into the production inbox. |
| 2026-09-04 | 2.1 — Asynchronous outbound delivery | Split durable message/job creation from Email Service delivery; browser and API sends return `202` with stable message and job IDs; the consumer loads the existing D1 message and R2 attachments, updates that same job, retries transient provider failures up to four attempts and records permanent/exhausted failures without reclassifying webhook or audit errors as send failures. | Production version `3edf3ebd-53e7-4e03-af55-8a5f4554bf60`; Cloudflare Email Sending confirmed enabled for `calibercode.io`; 40 tests and typecheck passed; lint completed with zero errors and 57 pre-existing warnings; isolated OpenNext build and Wrangler dry run passed; production login returned HTTP 200; production had no legacy queued outbound jobs before deployment. No synthetic email was sent. |
| 2026-09-04 | 2.2 — Outbound idempotency | Added client-supplied or generated idempotency keys, account-scoped hashes at rest, request fingerprints including attachment contents, a D1 uniqueness constraint, one atomic delivery claim, bounded pre-provider and explicit-transient retries, no-resend handling for unknown post-provider outcomes, and stable derived keys for calendar invitations and auto-replies. | Pre-migration backup `bak_pre_outbound_idempotency_20260904` completed with six independent R2 objects and 1,148,939 total bytes; migration `0028_add_outbound_idempotency.sql` passed on a fresh isolated D1 database and production; production version `bf4c78ce-f6b8-40bd-990e-19f331cdabcc`; 51 tests, typecheck, lint, isolated OpenNext build and Wrangler dry run passed; the production unique index was verified, no migrations remained, no jobs were stuck, and production login returned HTTP 200. No synthetic email was sent. An unauthenticated `/api/send` smoke request created no job but returned `500` instead of a clean `401`; response normalization remains a separate auth/API follow-up. |
