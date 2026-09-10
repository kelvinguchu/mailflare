# CC Mail Production Readiness

This is the working checklist for taking CC Mail from a functional beta to a dependable internal business mail client.

Audit date: 2026-09-01

Roadmap updated: 2026-09-09

Production: `https://mail.calibercode.io`

Last reviewed deployment: `c57e232b-fb4f-40fc-a71c-e3da78df1d47`

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

Status: `[x]` Staging is deployed with an independent Worker and stateful bindings. Provider delivery and Cloudflare management fail closed outside production, and all normal remote commands default to staging.

- [x] Define separate staging and production Workers.
- [x] Give staging separate D1, R2, Queue, Durable Object, Workflow and email test resources.
- [x] Document required variables, secrets and bindings.
- [x] Ensure production cannot be targeted accidentally by the normal development command.

Acceptance criteria:

- [x] A staging deployment cannot read, overwrite or send from production data.
- [x] The same release can be promoted from staging to production without rebuilding different source.

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

Status: `[x]` The failure-safe restore path and a repeatable staging drill are complete. The live drill verified D1 atomicity, R2 rollback, successful recovery, session invalidation and cleanup against the isolated staging resources.

- [x] Validate backup structure, version, tables, columns and object availability before deleting live data.
- [x] Add a maximum restore upload size.
- [x] Restore into a temporary or isolated database first where practical.
- [x] Define a rollback path for partial restoration failure.
- [x] Invalidate or deliberately preserve sessions after restoration.

Acceptance criteria:

- [x] An invalid or incomplete backup cannot erase the current database.
- [x] An injected failure during restoration leaves a documented recovery path.
- [x] A full restore drill succeeds in staging.

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

Status: `[x]` Inbound and outbound queues now have dedicated dead-letter queues whose consumers durably capture failures in D1; provider-declared final failures enter the same admin recovery view, and uncertain outbound outcomes remain deliberately non-replayable.

- [x] Configure dead-letter queues for inbound and outbound processing.
- [x] Store enough diagnostic context without exposing email contents in logs.
- [x] Add an admin view or controlled command to inspect and replay failed jobs.
- [x] Alert on sustained queue failures.

Acceptance criteria:

- Exhausted messages are recoverable instead of silently disappearing.
- Replay is idempotent and auditable.

### 2.5 Make webhooks reliable

Status: `[x]` Webhook events are persisted and delivered by a dedicated Queue consumer with stable signed envelopes, bounded retries, owner-scoped history/redelivery and scheduled retention.

- [x] Move webhook delivery off the request and mail-processing critical paths.
- [x] Retry temporary failures with bounded exponential backoff.
- [x] Include a stable delivery ID and timestamp in the signed payload.
- [x] Add manual redelivery and delivery history.
- [x] Define retention for webhook delivery records.

Acceptance criteria:

- [x] Temporary endpoint failure is retried automatically.
- [x] Receiving systems can deduplicate deliveries.
- [x] Webhook failure cannot make an otherwise successful email operation fail.

## Phase 3 — Complete account security and recovery

### 3.1 Implement secure password recovery

Status: `[x]` Recovery addresses require explicit ownership verification; public reset requests use constant responses and hashed account/IP rate-limit keys, while 30-minute single-use token hashes, session revocation, audit records and daily token cleanup are enforced in D1.

- [x] Create short-lived, single-use reset tokens stored only as hashes.
- [x] Send reset links only to the verified recovery address.
- [x] Rate-limit requests by account and IP without revealing whether an account exists.
- [x] Revoke reset tokens after use or password change.
- [x] Record reset activity in the audit log.

Acceptance criteria:

- [x] A user can recover access without administrator database intervention.
- [x] Reset tokens expire, cannot be reused and never appear in D1 as plaintext.

### 3.2 Improve administrator-created account activation

Status: `[x]` Administrators provide an external invitation address instead of a password; 72-hour single-use token hashes gate password creation, address verification and the first authenticated session, while resend and revoke controls invalidate every older link.

- [x] Replace reusable temporary passwords with an invite or one-time activation flow.
- [x] Require a new password at first sign-in.
- [x] Allow administrators to resend or revoke an invitation.
- [x] Show invitation and activation status in Accounts.

Acceptance criteria:

- [x] Administrators do not need to know a user's permanent password.
- [x] An unused or revoked invitation cannot activate an account.

### 3.3 Add session management

Status: `[x]` Account owners can review recent successful sign-ins and revoke every other session while preserving the current browser; password changes, password resets, invitation revocation and administrator actions invalidate the appropriate D1 sessions and close established realtime connections immediately, while the daily scheduler removes expired rows.

- [x] Revoke other sessions when a password changes or is reset.
- [x] Add “sign out other sessions.”
- [x] Let administrators revoke sessions for a compromised account.
- [x] Periodically delete expired session rows.
- [x] Display recent sign-in activity to the account owner.

Acceptance criteria:

- [x] A stolen old session cannot remain valid after account recovery.
- [x] Session revocation is immediate and tested.

### 3.4 Add stronger administrator authentication

Status: `[x]` Administrator-first TOTP MFA now uses encrypted secrets, hashed one-time recovery codes, replay-resistant verification, audited recovery/disable operations, and recent-authentication gates for privileged mutations.

- [x] Add TOTP or WebAuthn/passkey MFA, beginning with administrator accounts.
- [x] Generate and securely store recovery codes.
- [x] Require recent authentication for high-risk actions.
- [x] Consider Cloudflare Access as an additional outer gate for the internal deployment. A blanket hostname gate is rejected because public mail and recovery endpoints share the Worker; any future Access policy must be restricted to administrator browser paths and separately validate service routes.

Acceptance criteria:

- [x] An enrolled administrator cannot authenticate with a reused password alone.
- [x] Recovery uses one-time codes and does not require bypassing authentication in the database.

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

Status: `[x]` Critical mail paths run against isolated Workers-runtime D1 and R2 bindings with Queue-compatible provider seams, including signed webhook retry and redelivery behavior.

- [x] Inbound routing and aliases.
- [x] Inbound retry and deduplication.
- [x] Outbound authorization and sender identity.
- [x] Outbound queue retry and idempotency.
- [x] Shared mailbox permissions.
- [x] Attachment authorization and storage cleanup.
- [x] Auto-reply loop prevention.
- [x] Webhook signing and retries.

Acceptance criteria:

- [x] Critical mail flows run against isolated D1, R2 and Queue-compatible test bindings.
- [x] Tests prove both allowed and forbidden mailbox actions.

### 4.2 Add backup and migration tests

Status: `[x]` The Workers-runtime integration suite continuously exercises every backup table, referenced R2 objects, all legacy formats, the complete migration chain and failure rollback against isolated local bindings.

- [x] Round-trip every supported table through export and restore.
- [x] Test old backup-format compatibility.
- [x] Test every migration against a copy of the preceding schema.
- [x] Test restoration failure without corrupting the source database.

Acceptance criteria:

- [x] A fresh database and an upgraded database produce the same expected schema.
- [x] Backup restoration is continuously verified rather than assumed.

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
- [x] Revoke sessions.
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

## Owner-requested feature expansion

These features are split into backend and frontend tracks. Complete and verify the backend contract, migration and authorization rules before wiring the corresponding interface. Do not combine this work with the TanStack Start migration.

### Backend track

#### B1 Add CC recipient semantics

- [ ] Model `To` and `Cc` recipients explicitly in persisted outgoing and incoming messages.
- [ ] Include CC recipients in outbound MIME generation and inbound parsing without weakening mailbox authorization.
- [ ] Preserve CC metadata through queued delivery, retries, backups, restores, replies and forwards.
- [ ] Add validation, recipient limits and tests for duplicate addresses across `To` and `Cc`.

Acceptance criteria:

- A CC recipient receives the message and all recipients see the correct `To` and `Cc` headers.
- Retrying a queued message cannot change or duplicate its recipient set.

#### B2 Add safe rich-text signatures

- [ ] Store both sanitized HTML and plain-text signature variants per account or sender identity.
- [ ] Define a conservative formatting allowlist for links, text styles, lists and optional hosted images.
- [ ] Sanitize signatures on write and again when composing the final outbound MIME message.
- [ ] Define signature placement for new messages, replies and forwards.
- [ ] Include signatures in backup, restore and audit coverage.

Acceptance criteria:

- Signatures retain approved formatting in common mail clients and have a readable plain-text fallback.
- Script, event-handler, unsafe URL, SVG and CSS injection cannot enter the final message through a signature.

#### B3 Add cancelable delayed sending (“Undo send”)

- [ ] Add a configurable short send delay and a durable `scheduled`/`canceled` job state.
- [ ] Return an undo deadline with the send response.
- [ ] Add an authenticated cancellation endpoint using an atomic D1 state transition.
- [ ] Make the queue consumer enforce `send_not_before` and refuse delivery of canceled jobs.
- [ ] Preserve idempotency when cancellation races with queue delivery.

Acceptance criteria:

- Undo succeeds throughout the advertised window and guarantees the provider was not called.
- Once provider delivery begins, the UI and API no longer claim the message can be undone.

#### B4 Add TOTP multi-factor authentication

This extends Phase 3.4 and should begin with administrator accounts.

- [x] Add enrollment, verification, disable and recovery flows with recent-password confirmation.
- [x] Encrypt TOTP secrets at rest with an application secret that is not stored in D1.
- [x] Generate one-time recovery codes and store only their hashes.
- [x] Add rate limits, replay protection, audit events and administrator recovery rules.
- [ ] Support an enforce-MFA policy beginning with administrators, then optionally all users.

Acceptance criteria:

- A password alone cannot authenticate an enrolled administrator.
- TOTP codes cannot be replayed, recovery codes are single-use and no MFA secret is returned after enrollment.

#### B5 Expand calendar into events, tasks and reminders

- [ ] Define separate event, task and reminder models with ownership and mailbox/workspace authorization.
- [ ] Store timezone-aware dates, all-day semantics, task completion and reminder schedules explicitly.
- [ ] Define recurrence and exception behavior before adding repeating events or tasks.
- [ ] Dispatch due reminders through an idempotent scheduled backend process with delivery history.
- [ ] Preserve calendar, task and reminder state through backup and restore.
- [ ] Add APIs for filtered ranges, overdue tasks, completion and reminder dismissal/snoozing.

Acceptance criteria:

- Due reminders are emitted once despite repeated scheduler execution.
- Timezone changes and daylight-saving transitions do not silently move event or reminder intent.
- Users cannot read or mutate another account's calendar or tasks without explicit permission.

### Frontend track

#### F1 Redesign authentication screens

- [ ] Replace Gmail-like layout and visual language with an original CC Mail login, recovery and MFA experience.
- [ ] Use the existing CC Mail branding consistently without imitating another provider's interface.
- [ ] Add responsive, accessible error, recovery and TOTP challenge states.
- [ ] After deployment, verify Safe Browsing/Search Console status and request review if necessary; visual redesign alone is not proof that a warning is resolved.

#### F2 Replace full-screen loading states

- [ ] Keep the current page shell visible during ordinary data mutations and navigation.
- [ ] Use local spinners, disabled controls or skeletons only where data is pending.
- [ ] Reserve a full-screen blocking state for initial session bootstrap or operations that genuinely make the whole page unsafe to use.

#### F3 Expose CC composition

- [ ] Add a collapsible CC field with address chips, validation and keyboard support.
- [ ] Render `To` and `Cc` consistently in message detail, reply and forward views.

#### F4 Add a rich signature editor

- [ ] Provide only the formatting supported by the backend sanitization policy.
- [ ] Show HTML and plain-text previews and make signature placement understandable.

#### F5 Add the Undo send interaction

- [ ] Show a non-blocking confirmation with an Undo action for the exact server-provided deadline.
- [ ] Resolve cancellation success, expiry and network races honestly without implying a sent message was recalled.

#### F6 Add MFA setup and challenge interfaces

- [ ] Add QR/manual-key enrollment, code confirmation and recovery-code acknowledgement.
- [ ] Add sign-in challenge, trusted error handling and recent-authentication prompts for high-risk actions.

#### F7 Expand the calendar interface

- [ ] Add event, task and agenda views with clear overdue and completed states.
- [ ] Add reminder creation, snooze and dismissal controls.
- [ ] Make timezone and recurrence behavior visible instead of implicit.

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

1. `0.2` — Create fully isolated staging resources and safe deployment commands.
2. `1.4` — Run and document the full staging restore drill.
3. `4.1` and `4.2` — Lock mail, backup and migration behavior into integration tests.
4. `3.1` through `3.3` — Complete password recovery, account activation and session management foundations.
5. `B4` / `3.4` — Implement administrator-first TOTP on top of tested recovery and session behavior.
6. `B1` — Add CC recipient semantics end to end.
7. `B2` — Add safe rich-text signatures.
8. `B3` — Add cancelable delayed sending and its race-condition tests.
9. `B5` — Build the calendar/task/reminder backend in bounded schema and scheduling increments.
10. `F1` through `F7` — Implement each frontend surface only after its backend contract passes, then re-evaluate the TanStack Start migration gate.

## Decision log

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-09-01 | Personal mailboxes use the owner account avatar; shared mailboxes retain their own avatar. | Avoid duplicate avatar state and inconsistent rendering. |
| 2026-09-01 | Reliability work precedes the TanStack Start migration. | Preserve a testable behavioral baseline and avoid migrating known delivery/recovery risks. |
| 2026-09-04 | `_cf_KV`, `_cf_METADATA`, `d1_migrations`, and `sqlite_sequence` are classified as database-owned rather than application backup data. | Cloudflare D1, Miniflare, the migration runner, and SQLite recreate or manage these tables; restoring application rows must not overwrite their state. |
| 2026-09-04 | Outbound queue messages contain only a D1 job ID; provider delivery reads the durable message and R2 attachments in the consumer. | Keep queue payloads small, preserve a stable browser/API message ID and ensure one request creates one message and one job. |
| 2026-09-04 | An unclassified error after Email Service delivery begins is recorded as `E_DELIVERY_OUTCOME_UNKNOWN` and is not retried. | The current Email Service binding has no caller-supplied provider idempotency key and controls `Message-ID`; suppressing a possible email is safer than knowingly risking a duplicate. Explicit transient provider rejections remain retryable. |
| 2026-09-05 | Queue dead letters and provider-declared final outbound failures share one durable D1 recovery ledger; logs and the admin API expose only queue/reference IDs, safe error codes, attempts and timestamps. | Preserve replay material without leaking sender, recipient, subject, headers or body into logs or the operational UI. |
| 2026-09-05 | Manual replay is serialized by a short D1 claim and refuses outbound jobs with an in-flight or unknown provider outcome. | Existing delivery keys and outbound job claims make safe re-enqueue idempotent, while an ambiguous provider response can never be made safely replayable without provider idempotency support. |
| 2026-09-05 | Database backup format v4 includes dead-letter records and raw R2 messages referenced only by inbound failures; v1-v3 remain restorable. | A failed inbound message must remain recoverable even before it creates a normal `messages` row. |
| 2026-09-09 | Owner-requested features are split into backend and frontend tracks, with isolated staging and critical integration tests preceding schema, authentication and delivery changes. | CC, rich signatures, Undo send, TOTP and reminders cross persistence and security boundaries; defining and verifying backend behavior first avoids encoding UI assumptions into unsafe production changes. |
| 2026-09-09 | Local and staging environments fail closed for provider delivery and Cloudflare management; staging has no Email Sending binding, runtime credential, Email Routing rule, or active cron. Production remains an explicit named environment. | Resource-name isolation alone cannot prevent an accidental provider or control-plane call. Independent bindings plus runtime gates and explicit production commands create defense in depth without weakening production behavior. |
| 2026-09-09 | The staging restore drill requires an empty, uninitialized staging instance and an explicit `mailflare-staging` confirmation; it creates only run-scoped fixtures and removes its D1 and R2 artifacts after verification. | A recovery test is intentionally destructive. Fail-closed preflight and bounded cleanup prevent the reusable drill from becoming an accidental data-reset command. |
| 2026-09-09 | Auto-replies are suppressed for every sender address routed by the local CC Mail instance, not only the destination mailbox itself. | Two local mailboxes with auto-replies enabled could otherwise reply to each other indefinitely. |
| 2026-09-09 | Webhook delivery uses a dedicated Queue and a stable delivery ID across automatic and manual attempts; temporary failures retry at most five total attempts, and delivery records expire after 30 days. | Delivery must not block email processing, receivers need a durable deduplication key, and retry history must remain useful without growing forever. |
| 2026-09-09 | Administrator-created accounts begin pending with a random unusable password hash; activation requires a 72-hour, hashed, single-use invitation sent to an external address, and successful activation also verifies that address for recovery. | Administrators never handle user passwords, existing accounts remain active through the migration, and resend, revoke or provider failure makes every displaced link unusable. |
| 2026-09-09 | Session revocation deletes D1 credentials before closing every realtime socket for the account; the current browser reconnects only when its preserved session remains valid. Recent sign-in history is derived from owner-scoped successful-login audit records. | Database-first invalidation prevents an established socket from extending a revoked credential, while preserving the initiating session avoids an unnecessary password-change logout and owner scoping prevents cross-account activity disclosure. |
| 2026-09-10 | Administrator TOTP secrets use per-environment AES-GCM keys stored as Worker secrets; recovery codes are hashed and single-use, TOTP counters reject replay, and privileged mutations require authentication within 15 minutes. Cloudflare Access is not applied to the shared hostname as a blanket gate. | A stolen password alone cannot authenticate an enrolled administrator, D1 and backups never contain plaintext recovery codes or TOTP seeds, and a broad Access policy cannot accidentally block inbound mail, callbacks, activation, or recovery routes. |

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
| 2026-09-05 | 2.4 — Dead-letter handling and replay | Added dedicated inbound/outbound DLQs, durable idempotent D1 capture, safe structured diagnostics, provider-final-failure capture, an administrator-only failure history and serialized replay action, an app-wide unresolved-failure alert, and backup format v4 coverage for failure payloads and their raw inbound R2 sources. | Pre-migration backup `bak_pre_dead_letters_20260905` completed through Workflow `5199fc14-80e0-4378-8ab5-d75b320032c6` with eight independent R2 objects and 1,432,182 total bytes; migration `0029_add_dead_letter_events.sql` passed on isolated and production D1; production version `c57e232b-fb4f-40fc-a71c-e3da78df1d47`; 58 tests, typecheck, lint, isolated Next/OpenNext builds and Wrangler dry run passed; all four queue consumers and both new queue resources were verified; no migrations remained; production login and the new page returned HTTP 200; the admin API returned 403 without a session; production had zero unresolved failures and all ten outbound jobs were sent. No synthetic email was sent. |
| 2026-09-09 | Owner-requested feature planning | Added separate backend and frontend tracks for CC recipients, safe rich signatures, delayed send/Undo, TOTP, original login design, local loading states, and expanded calendar/tasks/reminders. Re-prioritized the next work around isolated staging, the restore drill and integration tests before feature schema or authentication changes. | Roadmap review only; no runtime code, infrastructure or production state changed. |
| 2026-09-09 | 0.2 — Safe deployment environments | Added explicit local, staging and production Wrangler environments; moved every non-inheritable binding into each named environment; made normal remote commands default to staging; added an automated resource-reuse gate; and made provider delivery and Cloudflare management fail closed outside production. | Staging version `74bd948c-6ee7-42d0-8c50-97b7ec00da58` at `mailflare-staging.agabio.workers.dev`; separate D1, R2, four Queues, Durable Object and Workflow verified; cron disabled; 30 migrations applied; staging secrets, users, messages and outbound jobs all empty; 61 tests, typecheck, lint, isolated OpenNext build and both Wrangler dry runs passed; `/login` reached the empty-instance `/setup` route with HTTP 200; production remained healthy on `c57e232b-fb4f-40fc-a71c-e3da78df1d47`; no synthetic email was sent and no restore drill was run. |
| 2026-09-09 | 1.4 — Full staging restore drill | Added a fail-closed reusable drill runner and exercised the deployed backup Workflow and restore API with representative D1 data plus user avatar, mailbox avatar, branding icon, raw email, inline image and downloadable attachment objects. | Run `drill_20260909065804_7808a312`; backup `bak_0xm-BlgBecFj9gbQOsEWa`; injected final-batch uniqueness failure left recovery bundle `bak_restore_ac5b4f2a70744678876257bb7662b2d4`, preserved the mutated D1/R2 state and kept the session valid; the valid restore created recovery bundle `bak_restore_4b1b21b9e45741c389034c723af87d43`, restored all six objects and D1 values, invalidated every session and left zero temporary tables. The runner verified cleanup returned staging to zero application rows, restored default settings and removed every known R2 fixture and bundle key. Production was not accessed or changed by the drill. |
| 2026-09-09 | 4.1 mail-path integration foundation and 4.2 backup/migration integration | Added a secret-isolated Workers-runtime Vitest project with real local D1 and R2 bindings, Queue-compatible mail seams, full table/object restore fixtures, legacy v1-v3 restore coverage and sequential migration verification. The suite exposed and fixed cross-mailbox auto-reply loops and Miniflare's `_cf_METADATA` backup classification. Item 4.2 is complete; 4.1 remains open only for durable webhook retry behavior tracked by 2.5. | 61 unit tests and 12 Workers integration tests passed; every one of 30 migrations applied against its preceding schema and matched the fresh schema; source and integration typechecks passed; lint completed with zero errors and the same 57 warnings. No remote resources, staging or production were accessed. |
| 2026-09-09 | 2.5 — Reliable webhooks and completion of 4.1 | Moved endpoint delivery to a dedicated Queue; added stable signed delivery IDs/timestamps, five-attempt exponential retry for network/429/5xx failures, durable status details, owner-scoped history and manual redelivery, a delivery-history interface, and 30-day scheduled retention. | Pre-migration production backup `bak_scheduled_2026-09-09` was complete at 2,118,220 bytes; migration `0030_add_webhook_delivery_retries.sql` applied to staging and production; staging version `9b179d1d-7eff-4151-b497-4ead93b54ad4`; production version `e3568848-c8ca-4510-b769-5d1385f4b0e3`; both webhook queues show one producer and one consumer; production had zero webhook deliveries in flight, all ten outbound jobs remained sent, no migrations remained, and production returned HTTP 200. The isolated OpenNext build and Wrangler dry run passed; 61 unit tests, 12 Workers integration tests, source/integration typechecks and environment-isolation checks passed; lint had zero errors and 57 pre-existing warnings. No synthetic email or webhook was sent. |
| 2026-09-09 | 3.2 — Administrator-created account activation | Replaced administrator-selected temporary passwords with external-address invitations; added pending, active, expired and revoked states; required the user to choose the permanent password; verified the recovery address during activation; blocked pre-activation login; and added administrator resend, address-correction and revoke controls. | Pre-migration production backup `bak_prerelease_account_activation_20260909` completed at 2,119,434 bytes; migration `0032_add_account_activation.sql` applied to staging and production; final staging version `9e819700-2521-4486-829e-6dddb6f05fc7`; final production version `b3976368-67d6-48af-b925-fdc2272c4bf7`; 63 unit tests and 21 Workers integration tests passed; source/integration typechecks, lint with zero errors and 57 pre-existing warnings, Next/OpenNext builds and Wrangler dry run passed. Production routes returned expected 200/401/400 statuses, all three existing users remained active, zero activation tokens existed, and all ten outbound jobs remained sent. No synthetic invitation was sent. |
| 2026-09-09 | 3.3 — Session management | Added owner-visible recent successful sign-ins, current-session-aware “sign out other sessions,” password-change/reset revocation, administrator all-session revocation, realtime Durable Object disconnects, indexed session queries and daily expired-row cleanup. | Pre-migration production backup `bak_prerelease_session_management_20260909` completed at 2,120,132 bytes; migration `0033_add_session_management_indexes.sql` applied to staging and production; final staging version `543f1bea-55e9-44f1-9217-2fa3df6efc63`; production version `816d926b-a796-4514-8968-fc395f3a26fe`; 63 unit tests and 26 Workers integration tests passed; source/integration typechecks, lint with zero errors and 57 pre-existing warnings, Next/OpenNext builds, environment-isolation checks and both Wrangler dry runs passed. Production returned HTTP 200 for login and the new APIs returned 401/403 without authentication; all three accounts remained active, two existing active session rows remained present, zero expired sessions or recovery tokens existed, and all ten outbound jobs remained sent. No synthetic email or invitation was sent. |
