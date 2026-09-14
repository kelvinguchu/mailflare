# CC Mail — Remaining Production Readiness Work

Last pruned: 2026-09-14

This file contains only work that is still incomplete or still requires deployment verification.
Completed phases, decisions, and progress logs have been removed.

## Deployment of completed local work

The following D1 migrations are applied locally but are still pending in both staging and production:

- [ ] Apply `0039_add_conversation_threads.sql` to staging together with matching Worker code.
- [ ] Apply `0040_add_task_assignments.sql` to staging together with matching Worker code.
- [ ] Apply `0041_add_rich_mailbox_signatures.sql` to staging together with matching Worker code.
- [ ] Run staging smoke and integration checks for conversation threads, task assignments, and rich signatures.
- [ ] Promote the same verified release and migrations to production.
- [ ] Verify production health and create a recoverable pre-release backup before production migration.

Acceptance criteria:

- Staging and production have no pending migrations.
- The deployed Worker and D1 schema come from the same release.
- Existing messages, tasks, mailboxes, and signatures remain accessible after migration.

## 6.2 Complete indexed message search

- [ ] Decide whether full bodies and attachment names/content are searchable in addition to sender, recipient, subject, and snippet.
- [ ] Replace the current FTS-table `LIKE` queries with a safe indexed FTS `MATCH` strategy.
- [ ] Add date-range, sender, recipient, attachment-presence, and mailbox filters.
- [ ] Validate and bound query length, filters, result size, and query complexity.
- [ ] Add integration tests for authorization, escaping, malformed queries, filters, and result ordering.
- [ ] Benchmark search with a representative multi-year mailbox dataset.

Acceptance criteria:

- Search uses the index rather than scanning matching text with `LIKE`.
- Search remains responsive with a representative multi-year mailbox dataset.
- Search cannot expose messages outside the user's accessible mailboxes.

## 6.3 Improve message-list performance

- [ ] Add compound indexes for actual mailbox, status, folder, read, thread, and date query patterns.
- [ ] Replace deep offset pagination with stable cursor pagination.
- [ ] Measure and record D1 query plans before and after index changes.
- [ ] Load-test message counts, thread lists, inbox navigation, and mailbox switching.

Acceptance criteria:

- Inbox and folder navigation remain responsive as message counts grow.
- Pagination does not skip or duplicate messages when new mail arrives.

## 6.4 Add storage lifecycle management

- [ ] Define trash retention and explicit permanent-deletion behavior.
- [ ] Delete associated raw email and attachment objects from R2 after permanent deletion.
- [ ] Clean orphaned R2 objects left by failed or interrupted operations.
- [ ] Define and enforce retention for audit logs, webhook deliveries, dead-letter records, and failed jobs.
- [ ] Make permanent deletion auditable and failure-safe across D1 and R2.

Acceptance criteria:

- D1 and R2 do not grow indefinitely from deleted or failed operations.
- Partial deletion failures are observable and safely retryable.

## 7.1 Complete account lifecycle controls

- [ ] Add a safe reset or re-invitation flow for an existing account.
- [ ] Transfer mailbox ownership without losing access or audit history.
- [ ] Archive or delete an account safely, including sessions, assignments, owned mailboxes, and retained mail.
- [ ] Export a complete account data package.

Acceptance criteria:

- Administrators cannot orphan mailboxes, tasks, or retained data during an account transition.
- Destructive actions require explicit confirmation and create audit records.

## 7.2 Complete operational visibility

- [ ] Add aggregate queue and delivery health, including backlog, retry, failed, suppressed, and unknown outcomes.
- [ ] Add D1 and R2 storage usage and growth visibility.
- [ ] Show backup freshness, the last successful backup, and the last verified restore drill.
- [ ] Add thresholds or alerts for unhealthy queues, stale backups, and abnormal storage growth.

Acceptance criteria:

- An administrator can identify mail-processing, storage, and backup problems without querying infrastructure manually.
- Operational views do not expose message bodies, credentials, or other sensitive content.

## 7.3 Complete accessibility and responsive verification

- [ ] Complete keyboard navigation for mail, compose, settings, administration, and calendar workflows.
- [ ] Verify focus management and screen-reader names, descriptions, errors, dialogs, and live regions.
- [ ] Test narrow desktop, tablet, and mobile layouts.
- [ ] Check contrast, reduced-motion behavior, zoom, and large text.
- [ ] Add automated accessibility checks for critical routes and complete a manual keyboard/screen-reader pass.

Acceptance criteria:

- Critical workflows are usable without a pointer.
- Responsive layouts do not hide or make required actions unreachable.

## B1 / F3 Add CC recipient semantics and interface

- [ ] Model `To` and `Cc` recipients explicitly for persisted inbound, outbound, draft, reply, and forwarded messages.
- [ ] Generate and parse correct `To` and `Cc` MIME headers without weakening mailbox authorization.
- [ ] Preserve CC recipients through queued delivery, retries, idempotency fingerprints, backups, restores, replies, and forwards.
- [ ] Add recipient validation, limits, normalization, and duplicate handling across `To` and `Cc`.
- [ ] Add a collapsible CC composer field with accessible address chips and keyboard support.
- [ ] Render `To` and `Cc` consistently in message detail, conversation, reply, and forward views.

Acceptance criteria:

- All intended recipients receive one message and see the correct `To` and `Cc` headers.
- Retrying a queued message cannot change or duplicate its recipient set.

## B4 Complete the MFA policy layer

- [ ] Add an enforce-MFA policy for administrators.
- [ ] Optionally support an enforce-MFA policy for all users without locking out recovery or setup flows.
- [ ] Define enrollment grace periods, policy exceptions, and administrator recovery behavior.

Acceptance criteria:

- Accounts covered by policy cannot continue indefinitely with password-only authentication.
- Policy enforcement cannot make account recovery or initial MFA enrollment impossible.

## F1 Complete post-deployment authentication checks

- [ ] Deploy the original CC Mail authentication design.
- [ ] Verify Safe Browsing and Search Console status after deployment.
- [ ] Request provider review if a warning remains; do not treat visual redesign alone as proof of resolution.

## F2 Remove ordinary full-screen loading blocks

- [ ] Stop the global loading transition from waiting on all React Query requests during ordinary navigation.
- [ ] Keep the application shell and existing usable content visible while route data is pending.
- [ ] Use local skeletons, spinners, disabled controls, and optimistic updates for bounded operations.
- [ ] Reserve full-screen blocking for initial session/bootstrap work that genuinely makes the whole application unsafe to use.

Acceptance criteria:

- Slow secondary requests cannot make the whole application appear hung.
- Users retain navigation context during ordinary loading and mutations.

## F4 Add the rich signature editor

- [ ] Replace the legacy plain-text textarea with an editor limited to the backend formatting allowlist.
- [ ] Support upload, placement, replacement, and removal of approved inline signature images.
- [ ] Show sanitized HTML and plain-text previews.
- [ ] Explain signature placement for new messages, replies, and forwards.
- [ ] Preserve the existing plain-text editing fallback.

Acceptance criteria:

- The editor cannot produce markup that the backend will unexpectedly remove or reinterpret.
- Saved signatures render predictably in HTML and plain-text email clients.

## F6 Finish MFA enrollment UX

- [ ] Add QR-code enrollment while retaining the manual setup key.
- [ ] Require explicit acknowledgement that recovery codes were saved before leaving setup.
- [ ] Verify accessible errors and focus behavior across enrollment, challenge, recovery-code, and recent-authentication flows.

## F7 Finish calendar presentation gaps

- [ ] Add a dedicated agenda view covering events and tasks with clear overdue and completed states.
- [ ] Make the current lack of recurrence support explicit in event and task interfaces.
- [ ] Add recurrence UI only after series, occurrence, and exception semantics are implemented in the backend.
- [ ] Complete responsive and accessibility testing for calendar, task assignment, and reminder workflows.

Acceptance criteria:

- Users can understand upcoming work in a chronological agenda.
- The interface never implies that repeating events or tasks are supported when they are not.

## Framework migration gate

- [ ] Document the current application behavior well enough to detect framework-migration regressions.
- [ ] Re-evaluate the TanStack Start migration only after the remaining behavioral contracts and production deployment state are understood.

The migration must preserve behavior first and improve architecture second. Do not combine it with mail-delivery, persistence, or authentication redesign in the same unverified release.
