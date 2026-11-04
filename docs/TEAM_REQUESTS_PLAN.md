# Mailflare team requests: implementation plan

Prepared 7 October 2026. Implementation repository: `D:\mailflare`.

## Goal and scope

Allow every active administrator to create accounts on the application's configured domains; make tasks and reminders available to every active authenticated user; resolve attachment sends that appear to hang; provide working previews for supported files; offer a deliberate calendar action for attached meeting invitations. Match Mailflare's existing UI and keep copy short.

Implement and verify in the new chat. Production diagnostics may be read-only. Do not deploy, apply production migrations, replay failed deliveries, or send test messages to real recipients until explicitly requested for this work. Preserve existing user edits and follow `AGENTS.md`, including the development-server rules.

## Findings from the current source

- `src/app/api/accounts/route.ts` already checks the administrator role. However, `getDomainForAdmin` in `src/app/api/accounts/utils.ts` also requires `domains.userId` to equal the acting administrator. `GET /api/domains` lists domains using user/creator ownership. This can hide or reject domains for another administrator.
- Task and reminder creation routes require authentication, not the administrator role. `createCalendarTask` defaults the assignee to the creator, permits assignment to an eligible user, and checks access if a mailbox is supplied. Reminder listing is scoped to its owner. Inspect UI, session state, sender/mailbox selection, and error responses before assuming a role restriction is the cause.
- Composer attachments travel in one multipart `/api/send` request. Parsing buffers the request and reads files into ArrayBuffers. `storeMessageAttachments` writes R2 objects and metadata sequentially. The browser's send request has no bounded wait or upload progress; its loading toast can remain indefinitely. Successful queue acceptance is labelled "Message sent" even when actual delivery has not occurred.
- Current limits are 10 files, 10 MiB per file, 20 MiB combined attachments, and 30 MiB for the send request. Signature assets also count toward the final email.
- Current Cloudflare docs specify a 5 MiB total message limit for general recipients; 25 MiB applies only to verified destination addresses. This is an identified mismatch, not proof of the specific reported hang. Check production errors and stage timings to establish the actual failure.
- Message attachment previews already exist for PDF, raster images, audio, video, plain text, CSV, JSON, and XML. The attachment endpoint checks message access and quarantine status. It currently serves whole objects without HTTP Range support. Composer attachment chips have no preview action.
- Calendar code already generates iCalendar invitations in `src/lib/calendar/utils.ts`; reuse the existing event/reminder infrastructure rather than creating a separate calendar.

Sources checked 7 October 2026:

- Cloudflare limits: https://developers.cloudflare.com/email-service/platform/limits/
- Workers email API: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- iCalendar specification for implementation: https://www.rfc-editor.org/rfc/rfc5545
- Scheduling specification for implementation: https://www.rfc-editor.org/rfc/rfc5546

Consult current official docs before implementation. Local Cloudflare email skill references still describe older limits; official documentation takes precedence.

## 1. Account creation by every administrator

1. Trace Accounts navigation, page guards, domain options, account creation, invitation delivery, and mailbox provisioning as a second administrator who does not own the configured domain.
2. Define one server-side administrator domain lookup/list policy. For this single Mailflare installation, an active administrator may select any domain configured in the application's database. Do not expose unrelated zones from the Cloudflare account, grant this capability to ordinary users, or silently alter domain ownership.
3. Reuse that policy in the account form and POST. Scope any broader `/api/domains` changes carefully because ordinary-user mailbox flows also consume it.
4. Keep existing duplicate-address checks, activation links, MFA policy, sender/domain readiness, and audit attribution to the actual creator. Preserve existing administrator lifecycle protections.
5. Cover concurrent account creation: database uniqueness must enforce the final decision, with a readable conflict response and appropriate cleanup for partial provisioning.

Acceptance: two distinct administrators can create and invite an account on the same configured domain; an ordinary user receives 403 from account creation; unrelated domains cannot be selected by forged IDs; no ownership or last-administrator protection changes.

## 2. Tasks and reminders for everyone

Interpret "everyone" as access to the features for active signed-in users. It does not automatically make every person's records globally readable or editable.

1. Verify Calendar navigation, task/reminder creation buttons, API routes, assignment picker, notification polling, and mailbox selection for both roles.
2. Every active user can create a personal task and a personal in-app reminder without needing a mailbox or administrator permission. Allow task assignment using the existing eligible-user rules; verify creator and assignee visibility and activity.
3. Email reminders require an authorized sender/mailbox; hide or explain this requirement only when that channel is chosen. Personal task/reminder creation must not depend on permission to manage mailboxes.
4. Preserve record ownership, creator/assignee controls, and mailbox access rules. Separate feature availability from record access in shared helpers so the policy can be revised later.
5. Verify completion, reassignment, cancellation, snooze, and notification behavior; prevent canceled/completed reminders from firing and duplicate deliveries on retry. Keep UTC storage and explicit timezone display, using Africa/Nairobi for the existing local default.

Acceptance: an ordinary active account creates, sees, updates/completes its task and receives/snoozes its reminder; assigned work is visible to the intended people; users cannot access another person's private reminder through a guessed ID; disabled accounts remain blocked.

## 3. Attachment sending: priority investigation and fix

### Establish the failure

- Reproduce with several small files, one large file, and near-limit mixed files. Exercise slow connections, a dropped connection, double-clicking Send, and a provider rejection.
- Trace browser upload, request parsing, signature rendering, R2 storage, database reservation, queue publication, attachment loading, and provider send separately. Inspect existing production jobs/errors read-only where needed. Record IDs, file counts/bytes, stage duration, and safe error details; never log bodies, file content, secrets, or recipient lists unnecessarily.
- Measure Worker memory and request processing; inspect `src/lib/http/request.ts` for duplicate buffering. Identify how much time is transfer versus server work rather than assuming additional parallelism solves it.

### Reliable delivery flow

1. Centralize limits and error codes used by the UI and APIs. Enforce the actual final message budget, including signature images, body, headers, MIME/base64 overhead, and attachment count. Use a conservative documented budget for general recipients unless an account-specific higher limit is verified. Revalidate after signature rendering and before provider submission.
2. Show selected count, total size, and a readable reason before sending an oversized message. Map size/count errors to a client error (400/413) rather than a generic 500. Keep the existing empty-body protection.
3. Add explicit states: preparing/uploading, queued with any Undo deadline, sending, provider accepted, failed, and outcome unknown. "Queued" must not be presented as confirmed delivery. Provider acceptance is not proof of delivery to the recipient's inbox; use "Delivered" only with evidence.
4. Prefer staged uploads if reproduction shows the current monolithic request causes the stall: authenticated per-file upload endpoints, at most 2-3 concurrent transfers initially, actual byte progress, retry per file, cancel, and server-issued attachment IDs. Queue only IDs/metadata after all files are ready. Avoid public R2 objects and do not accept client-chosen bucket keys.
5. If a smaller targeted fix resolves the issue, keep the existing endpoint compatible and avoid an unnecessary upload rewrite. Bounded concurrency, progress, and deadlines must be based on measured stages. If staging is introduced, keep `/api/v1/send` and existing integrations compatible.
6. Uploaded files belong to the uploader and draft/send context. Recheck ownership, allowed sender/mailbox, size, security status, and object existence when finalizing. Seal the attachment set with the send's idempotency key; retries of an unchanged send produce exactly one job. Race-safe finalization must prevent two sends from claiming temporary files incorrectly.
7. Use bounded waits and retries. A browser timeout does not prove the server failed: check the existing send outcome with the same idempotency key before retrying. Preserve message text, recipients, attachments, and draft state on recoverable failure. Do not allow blind retries when provider delivery is uncertain.
8. Keep queue delivery, backoff, Undo Send, and DLQ policy. Ensure provider error code and safe detail are retained for diagnosis. Add bounded cleanup of expired unclaimed uploads only if staging is introduced; never delete attachments referenced by a saved draft or outbound message. Avoid premature deletion while a retry is in progress.

Possible storage additions if staging is needed: an upload record with user ID, draft/send context, object key, sanitized filename, detected/declared type, bytes, security status, creation/expiry, and claim state. Index owner/context lookups and expiry scans; enforce unique claims/idempotency in D1. Keep binaries in R2 and queue messages small. Use migrations for actual schema changes; do not recreate or wipe the existing database.

Acceptance: sending several supported files completes or returns a clear actionable failure within a bounded wait; progress is visible during real transfer; a network retry never produces duplicate emails; over-limit messages are rejected before provider submission; reload/failure does not silently lose the draft; queued and failed delivery states are accurate. Verify transmitted file bytes and filenames using a controlled provider mock or explicitly authorized recipient.

## 4. Attachment previews

1. Reuse and repair the existing viewer across received/sent messages and add previews for locally selected composer files using object URLs, revoked when removed/closed. Keep preview behavior consistent on desktop and mobile, with a download fallback.
2. First scope: PDF, safe raster images, plain text/CSV/JSON/XML rendered as text, and browser-supported audio/video. Do not execute HTML, SVG scripts, Office macros, or arbitrary embedded content. Unsupported Office/archive formats get filename, type, size, and download.
3. Verify MIME detection/normalization, PDF iframe behavior under current CSP, authentication, blocked/quarantined files, and loading/error states. Do not trust a filename extension alone. Prefer safe detection/fallback to loosening CSP broadly.
4. Support authenticated HTTP Range requests and correct 206/416 responses for stored PDF/media if needed for responsive previews; continue streaming R2 bodies and prevent shared caching. Bound text previews and offer download for large files. Empty text files must display an empty state instead of an endless skeleton.
5. Use a single supported-type policy for server and client where practical; include accessibility, keyboard close, meaningful titles, and clear failures without revealing whether an inaccessible attachment exists.

Acceptance: supported files open in message views and composer; PDF/media load on target browsers; unsupported, invalid, or quarantined files behave clearly; guessed IDs cannot retrieve another mailbox's files; viewers do not leak object URLs or download unbounded text into memory.

## 5. Calendar actions from attachments

1. Detect `.ics` and `text/calendar` in both composer and received attachments using type/content checks. Parse bounded input with a maintained iCalendar parser after checking Workers compatibility. Read supported meeting title, DTSTART/DTEND, all-day values, timezone, location, description, organizer, attendees, UID, SEQUENCE, METHOD, and supported alarm data.
2. Show a concise meeting summary and an explicit "Add to calendar" or "Create meeting" action. For sending an ICS, prefill the event form and show recipients as proposed attendees; the user confirms dates/timezone/attendees before creating an event or sending invitations.
3. Reuse existing calendar event/reminder APIs and sender permission checks. Deduplicate repeated imports using calendar/user scope plus UID and organizer; honor authorized updates by SEQUENCE and cancellation semantics. A forged invite must not update another organizer's event.
4. Parse UTC, TZID, date-only, and floating times deliberately. Ask for the timezone when ambiguous; do not silently shift appointments. Handle multiple VEVENTs with selection, and either support recurrence correctly or clearly identify unsupported recurrence before importing. Keep parsing and recurrence expansion bounded.
5. Never automatically accept invitations, send RSVP mail, fetch attachment URLs, or create meetings from arbitrary PDFs/docs. Display links as user actions and sanitize descriptions. Offer RSVP only when its scheduling semantics and authenticated sender behavior have been implemented correctly.

Acceptance: sending or receiving a supported ICS offers a prefilled calendar action; confirmation creates one correct event; re-importing does not duplicate it; timezones/all-day events retain their meaning; unsupported recurrence, malformed ICS, and invitation cancellations are handled explicitly.

## Suggested follow-ups, separate from required scope

- Convert an email into a task, linking back to the original message.
- Add a reminder to follow up on a sent message without inventing reply detection.
- Offer conflict warnings when importing meetings, with no automatic reschedule.
- Offer an explicit expiring download-link alternative for files too large for email. This requires a separate access/revocation design and should not silently publish attachments.
- Add RSVP tracking and meeting update/cancel UI after the basic ICS flow works.

Do not let these additions delay account access or the attachment fix; they are suggestions, not mandatory implementation.

## Delivery order and verification

1. Confirm permissions and attachment failure with a brief evidence-backed update.
2. Fix administrator domain access and ordinary-user task/reminder availability.
3. Fix attachment limits, observed stall, progress, and delivery status accuracy.
4. Complete supported previews.
5. Implement the confirmed ICS calendar action.
6. Run focused permission, multi-file send/idempotency, preview authorization, and ICS correctness tests plus relevant type/build checks. Use an isolated local database and provider mock for fixtures. Read current Next.js guides required by `AGENTS.md` before changing routes/UI.
7. Deliver a concise change report, test results, any migration requirements, and any unresolved provider limitation. Keep code reviewable, preserve existing work, and wait for an explicit deployment request for this feature set.

The new chat should create a goal for this implementation and persist until required scope is complete or a concrete external dependency is identified. Refresh source findings before editing; this plan records an initial review, not a full diagnosis.
