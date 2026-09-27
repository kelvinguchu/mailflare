# CC Mail frontend completion handoff

Last updated: 2026-09-15

## Purpose

This document is the execution brief for the frontend-focused model finishing the remaining CC
Mail production-readiness work. It is intentionally self-contained: read the referenced source
and contract files before editing, implement one workstream at a time, run the complete quality
gate, deploy the verified artifact where required, and prune only the work that is genuinely
complete from `PRODUCTION_READINESS.md`.

The remaining frontend order is:

1. F2 — remove ordinary full-screen loading blocks.
2. F6 — finish MFA enrollment UX.
3. F4 — add the rich signature editor.
4. F7 — finish calendar presentation gaps.
5. Reassess the framework migration gate only after all four behavior contracts are complete.

There is also one small internal-tool indexing task described below. It is independent of the
four main workstreams.

## Non-negotiable operating rules

- Work directly in `D:\mailflare`.
- Read `AGENTS.md` before editing. This repository uses Next.js 16.3.4, which differs from older
  Next.js versions. Read the relevant local documentation under `node_modules/next/dist/docs/`
  before changing routing, metadata, layouts, loading boundaries, or navigation behavior.
- Never stop, restart, replace, or otherwise interfere with the user-managed development server
  or anything using port 3000. Do not start another development server.
- Preserve the dirty working tree. Existing modifications belong to the user and earlier
  readiness work. Do not reset, revert, delete, or overwrite unrelated changes.
- Use `apply_patch` for source edits. Prettier may be used for mechanical formatting.
- Do not print `.dev.vars`, secrets, authenticator secrets, recovery-code hashes, cookies, API
  tokens, or private message content.
- Do not introduce Hono.
- Do not redesign authentication, message delivery, persistence, or Cloudflare bindings as part
  of a frontend workstream.
- Reuse existing UI primitives and visual language. Do not replace the established CC Mail
  interface with a new design system.
- Maintain keyboard access, visible focus, mobile reflow, reduced motion, and existing screen
  reader semantics documented in `docs/ACCESSIBILITY_RESPONSIVE.md`.
- Use an isolated release directory for OpenNext production builds. Never build into the live
  repository's `.next` or `.open-next` while the user's dev server is running.
- On Windows, install a real isolated dependency tree with `npm ci`. Do not junction the release
  directory's `node_modules` to the repository: OpenNext needs to create its own symlinks and a
  junction caused an `EPERM` bundle failure during the MFA release.
- Do not deploy from partially verified source. Staging and production must receive the same
  isolated build artifact.

## Current production baseline

- Production URL: `https://mail.calibercode.io`
- Current production Worker version at the time of this handoff:
  `ad080a4a-872c-4e60-b0f6-d19410fa931e`
- Current staging Worker version:
  `c0adf7c0-2624-4ca6-90f7-eb7d8716eff7`
- D1 migrations through `0048_add_mfa_policy.sql` are applied locally, in staging, and in
  production.
- No migration is expected for F2, F6, or the internal-tool indexing change. F4 and F7 should
  also use the existing backend unless discovery proves a genuine contract gap.
- Production MFA policy defaults to `optional`; do not enable enforcement as part of frontend
  work.

## Already completed — do not redo

- Responsive and accessibility foundations, including the skip link, main landmarks, global
  focus visibility, reduced-motion behavior, responsive sidebar, compose focus return, semantic
  conversation controls, and responsive calendar containers.
- Indexed and authorized message search.
- Stable message-list cursor pagination and list performance work.
- Storage lifecycle management.
- Account lifecycle controls.
- Operational visibility.
- Explicit To/Cc recipient semantics.
- MFA policy enforcement, grace periods, exceptions, recovery access, and administrator reset.
- Rich signature backend storage, sanitization, CID asset storage, MIME generation, and backup
  support.
- Calendar events, assigned tasks, reminders, reminder delivery, and timezone persistence.

Read these completed contracts before touching their interfaces:

- `docs/ACCESSIBILITY_RESPONSIVE.md`
- `docs/SIGNATURE_BACKEND.md`
- `docs/MFA_POLICY.md`
- `docs/CALENDAR_BACKEND.md`
- `docs/AUTHENTICATION_DEPLOYMENT_VERIFICATION.md`

## Small cross-cutting task — internal application indexing

The owner describes CC Mail as an internal tool. The public login URL must remain reachable for
authorized users, but it does not need search indexing.

Implement explicit indexing controls after reading the Next.js 16 metadata and metadata-file
documentation:

- Add global `noindex, nofollow` robots metadata in `src/app/layout.tsx`.
- Add a Next.js robots metadata route/file that disallows crawling of the application.
- If the existing headers architecture has an appropriate central location, also consider an
  `X-Robots-Tag: noindex, nofollow` response header. Do not duplicate header logic in every route.
- Add a small contract test that proves the metadata/robots behavior remains present.
- State clearly in documentation that robots directives are indexing controls, not access
  control. Do not add Cloudflare Access or alter CC Mail authentication without a separate product
  decision.
- Do not add the Search Console property merely to complete the old checklist. Public Google Safe
  Browsing already reported “No unsafe content found” on 2026-09-15. Search Console can remain an
  optional owner diagnostic if a future warning occurs.

After verification, update `docs/AUTHENTICATION_DEPLOYMENT_VERIFICATION.md` and remove F1 from
`PRODUCTION_READINESS.md`.

---

## Workstream 1 — F2 ordinary loading behavior

### User outcome

The shell, navigation, existing data, and current interaction context stay visible while bounded
queries or mutations run. A full-screen loader is shown only while the application cannot safely
decide whether the user may enter the protected shell.

### Current problem

`src/components/loading-transition.tsx` couples the full-screen bootstrap overlay to all of the
following:

- `ready` from `AuthGuard`;
- every React Query request through `useIsFetching()`;
- manually reported page loads through `PageLoadingContext`; and
- a ten-second maximum wait.

As a result, an unrelated or slow secondary request can hold the whole application behind the
logo even though the authenticated shell could already be useful.

The manual page-loading channel is currently used by:

- `src/components/conversation/conversation-view.tsx`
- `src/components/messages/message-folder-page.tsx`

Both surfaces already have or can use local loading presentation. They must not control the
global application overlay.

### Primary files

- `src/components/loading-transition.tsx`
- `src/components/loading-transition-types.d.ts`
- `src/components/page-loading.tsx`
- `src/components/page-skeletons.tsx`
- `src/components/auth/auth-guard.tsx`
- `src/components/conversation/conversation-view.tsx`
- `src/components/messages/message-folder-page.tsx`
- `src/app/(dashboard)/loading.tsx`
- `src/app/(admin)/loading.tsx`
- React Query consumers with mutation-specific pending states

### Required implementation

1. Make the global transition depend only on the initial protected-session/bootstrap decision.
   Remove its dependency on global `useIsFetching()` and ordinary page-query reporting.
2. Once protected children are revealed, never cover them again because a query refetches,
   invalidates, polls, or changes route data.
3. Remove `usePageLoading()` from message lists and conversation detail. If no legitimate global
   consumer remains, remove `PageLoadingContext`, `usePageLoading`, and their unused types rather
   than leaving a misleading no-op API.
4. Keep the existing message-detail skeleton for an initially empty conversation load.
5. Keep prior data visible during background refreshes. Calendar already uses
   `keepPreviousData`; use the same principle where the current feature supports it.
6. Preserve list content during refresh and show a bounded status near the list toolbar. Do not
   replace usable rows with a blank page.
7. Give mutations local pending behavior:
   - disable only controls that would duplicate or conflict with the mutation;
   - show progress in or beside the initiating control;
   - preserve navigation and unrelated controls;
   - use optimistic updates only when rollback behavior is explicit and tested.
8. Keep Next route `loading.tsx` files local to their content region. Existing
   `ListPageSkeleton` and `TableSkeleton` are suitable patterns; do not wrap them in the global
   full-screen logo transition.
9. Preserve `aria-busy`, `role="status"`, and live announcements for meaningful background work.
   Avoid announcing every polling request.
10. Preserve reduced-motion behavior and avoid minimum artificial waits after authorization is
    known.

### Important boundaries

- Do not weaken server authorization to make navigation appear faster.
- Do not treat a client guard as the security boundary; APIs remain authoritative.
- Do not change React Query cache ownership or clear-on-session-change behavior in
  `src/components/providers.tsx` unless required by a demonstrated bug.
- Do not turn every query into a skeleton. Existing content plus a subtle refresh status is often
  the correct UI.

### Tests to add or update

- A slow unrelated React Query request cannot keep or restore the full-screen loader after the
  auth bootstrap completes.
- Message-list initial load uses a list/content skeleton, not the global overlay.
- Conversation initial load uses `MessageDetailSkeleton` and retains the shell.
- Background refetch preserves existing list/calendar data.
- Mutation pending states disable only the relevant action.
- Initial protected bootstrap still blocks content until the authorization decision is made.
- Reduced-motion users do not receive an unnecessary delayed fade.

### Definition of done

- Slow secondary requests cannot make the application appear hung.
- Ordinary navigation retains the sidebar/header and the user's current context.
- No production route relies on `useIsFetching()` to decide whether the entire app is visible.
- The full-screen transition is reserved for initial session/bootstrap work.
- The complete quality gate, isolated Worker build, manual browser pass, staging deployment, and
  production deployment pass before F2 is removed from `PRODUCTION_READINESS.md`.

---

## Workstream 2 — F6 MFA enrollment UX

### User outcome

A user can enroll with a QR code or manual secret, verify a TOTP, save recovery codes, explicitly
confirm that the codes are safe, and then continue. Errors and focus movement are understandable
with keyboard and assistive technology. Restricted users retain enrollment, recovery, logout, and
password-recovery paths.

### Existing backend contract

`src/app/api/settings/mfa/route.ts` already implements:

- `GET` — `{ enabled, recoveryCodesRemaining, policy }`
- `POST` with `{ currentPassword }` — `{ secret, otpauthUri }`
- `PUT` with `{ code }` — enables MFA and returns one-time `{ recoveryCodes }`
- `PATCH` with current password and authenticator/recovery code — replaces recovery codes
- `DELETE` with current password and authenticator/recovery code — disables MFA only when policy
  permits it

Do not change the security model. The secret is encrypted at rest, TOTP reuse is prevented,
recovery codes are hashed and single-use, and enabling enforcement requires an administrator to
hold recovery codes.

### Current frontend defect

In `src/components/settings/mfa-settings.tsx`, successful enrollment stores the returned recovery
codes and immediately calls `router.replace("/inbox")` when `enrollmentMode` is true. The user can
therefore be redirected before they have saved the codes. F6 must remove that automatic redirect.

### Primary files

- `src/components/settings/mfa-settings.tsx`
- `src/components/auth/mfa-enrollment.tsx`
- `src/app/(auth)/enroll-mfa/page.tsx`
- `src/app/(auth)/login/login-client.tsx` for MFA challenge/recovery-code behavior
- `src/components/settings/reauthentication.tsx`
- `src/app/api/settings/mfa/route.ts` only if frontend discovery reveals a real contract gap
- Existing MFA integration tests under `tests/integration/`

### Required implementation

1. Render a QR code from the returned `otpauthUri` locally in the browser.
   - Never send the URI or secret to a remote QR-generation service.
   - Use a small, maintained local QR dependency if one is needed; update the lockfile and pass
     the dependency audit.
   - Give the QR image a useful accessible name and retain the visible manual key.
2. Add clear setup steps: scan QR, or enter the manual key, then enter the current six-digit code.
3. Make the TOTP field mobile-friendly with `autoComplete="one-time-code"` and appropriate
   `inputMode`. Do not make the recovery-code challenge numeric-only because recovery codes may
   contain non-numeric characters.
4. After successful `PUT`, keep recovery codes on screen. Do not redirect automatically.
5. Provide copy and optional local-download/print actions. Never log codes and never persist them
   in localStorage, sessionStorage, a URL, analytics, or React Query cache.
6. Require a clearly labelled acknowledgement such as “I saved these recovery codes” before the
   final Continue button becomes available.
7. Continue to `/inbox` only from that explicit final action. In enforced enrollment, navigating
   elsewhere remains harmless because policy will redirect the user back to enrollment.
8. Warn before losing a newly displayed recovery-code set when feasible, without trapping users
   in an inaccessible browser-confirm loop.
9. Focus behavior:
   - after setup begins, move focus to the setup heading or first actionable setup control;
   - after a validation failure, focus the alert or invalid field and associate the error with the
     field;
   - after recovery codes are generated, focus the recovery-code heading/region;
   - after copying, announce success through a polite status region;
   - destructive and recent-authentication dialogs must restore focus when closed.
10. Maintain separate Sign out and Recover account actions for policy-restricted users.
11. Keep manual enrollment available even when QR rendering fails.

### Error cases to cover

- Incorrect current password.
- Expired/replaced setup secret.
- Invalid or reused TOTP.
- Rate limiting.
- Clipboard unavailable or denied.
- QR rendering failure with manual-key fallback.
- Network failure after setup begins.
- MFA becomes enabled in another tab.
- Policy changes while the enrollment page is open.

### Tests to add or update

- The QR payload exactly matches the server `otpauthUri` and is generated locally.
- The manual secret remains visible and copyable.
- Enrollment does not navigate immediately after verification.
- Continue remains disabled until acknowledgement.
- Recovery codes are absent from persistent browser storage and URLs.
- Accessible alert/status roles and focus targets work for setup, challenge, recovery-code, and
  reauthentication errors.
- Restricted users can still sign out and start account recovery.
- Keyboard-only completion works at mobile and desktop widths.

### Definition of done

- A user cannot accidentally leave the guided enrollment flow without being shown and explicitly
  acknowledging the one-time recovery codes.
- QR and manual-key enrollment both work.
- Challenge and recovery-code entry are not constrained to incompatible input formats.
- Screen reader and keyboard behavior passes a manual browser check.
- Full quality, isolated build, staging/production deployment, and smoke checks pass before F6 is
  pruned.

---

## Workstream 3 — F4 rich signature editor

### User outcome

Users with full mailbox access can create an email-safe formatted signature, add approved inline
images, preview the sanitized HTML and plain-text forms, understand where the signature appears,
and retain a plain-text editing fallback.

### Existing backend contract

Read `docs/SIGNATURE_BACKEND.md` completely. The important rules are:

- `PATCH /api/mailboxes/:mailboxId` accepts `signatureText` and `signatureHtml`.
- The response returns `signature`, `signatureText`, `signatureHtml`, and `signatureVersion`.
- The server is the final sanitizer and increments the version.
- Legacy `{ signature: "..." }` remains supported and clears rich HTML.
- Signature images use authenticated mailbox-scoped asset endpoints.
- Accepted files: JPEG, PNG, or GIF; maximum 512 KB and 1200×600.
- Maximum five images and 2 MB total per mailbox.
- Signature HTML must reference the returned `cid:` source exactly.
- Referenced assets cannot be deleted until removed from the saved signature.
- Send APIs support `includeSignature: true`; the server snapshots the latest signature and CID
  assets into the queued message.

### Primary files

- `src/components/settings/mailbox-signature-form.tsx`
- `src/components/settings/utils.ts`
- `src/components/settings/types.d.ts`
- `src/components/mailbox-provider.tsx`
- `src/components/mailbox-provider-utils.ts`
- `src/components/compose/compose-form.tsx`
- `src/components/compose/utils.ts`
- `src/app/api/send/types.d.ts`
- Mailbox signature asset routes under
  `src/app/api/mailboxes/[id]/signature/assets/`
- Signature unit and integration tests

### Editor scope

Build an intentionally limited email editor. Expose only operations the backend preserves, such
as:

- bold, italic, underline, and strike-through where supported;
- paragraph/line break;
- ordered and unordered lists;
- safe links;
- text alignment and a small safe color set only if the backend allowlist preserves them;
- managed signature images with alt text.

Do not expose scripts, forms, iframes, SVG, arbitrary HTML, remote images, data URLs, CSS URL
values, event handlers, or arbitrary pasted styling. Pasted rich content must be normalized to the
supported model before save.

### Required implementation

1. Inspect the actual backend allowlist in `src/lib/email/signatures.ts` before defining toolbar
   controls. Every visible command must round-trip through the sanitizer predictably.
2. Prefer a small controlled document model or a narrowly configured maintained editor. Do not
   add a large editor dependency without checking bundle cost, Workers compatibility, licensing,
   and the dependency audit.
3. Treat server-returned HTML as canonical after save. Update editor state and mailbox provider
   state from the sanitized response rather than assuming the submitted HTML survived unchanged.
4. Update `updateMailboxSignature` to support the rich payload and return the complete signature
   result, not only the legacy string.
5. Provide a visible plain-text fallback mode. Switching to and saving the legacy mode must use
   the existing legacy payload deliberately and explain that rich formatting is cleared.
6. Add authenticated asset list/upload/delete helpers.
7. Validate file type, size, dimensions, count, and total size client-side for fast feedback, but
   treat server validation as authoritative.
8. Insert the exact returned `asset.src` CID into the editor model. Use `previewUrl` only for the
   authenticated settings preview.
9. Require meaningful alt text for informative images; allow empty alt text only when the user
   explicitly marks the image decorative.
10. When deleting a referenced image, remove it from the signature and save the signature first,
    then delete the asset. Handle the backend `409` without losing editor content.
11. Never render untrusted editor HTML directly into the main document without the same strict
    client-side model/sanitization guarantees. The saved-preview tab must display the exact
    sanitized server result.
12. Show both previews:
    - sanitized HTML, including authenticated image previews;
    - the server-canonical plain-text fallback.
13. Explain placement for new messages, replies, and forwards. Signatures are appended by the
    server when `includeSignature` is true.
14. Update sending so a rich-aware composer sends user body content without manually injecting
    the mailbox signature and sets `includeSignature: true`.
15. Prevent duplicate signatures during the transition from the current client-side behavior:
    `compose-form.tsx` currently calls `applyMailboxSignature()` whenever the selected mailbox
    changes and includes that text in drafts. Account for existing drafts that may already contain
    a legacy signature before enabling server insertion.
16. Test mailbox switching, draft restore, new mail, reply, forward, retry, and queued delivery.
    A later signature edit must not change an already queued message.

### Suggested component boundaries

- `MailboxSignatureForm` — data loading, permissions, save lifecycle, mode switch.
- `SignatureEditor` — restricted document editing and toolbar.
- `SignatureAssetManager` — list, upload, replace, delete, alt text, quota display.
- `SignaturePreview` — canonical HTML/plain-text tabs.
- Small typed client functions for mailbox signature and asset APIs.

Keep component names consistent with repository conventions; these boundaries are guidance, not
a requirement to create unnecessary abstraction.

### Tests to add or update

- Every exposed editor command round-trips through backend sanitization.
- Unsafe paste content is removed or normalized.
- Remote/data images and unsafe links never survive.
- Upload limits and server errors are presented without clearing the editor.
- CID image insertion, replacement, and deletion follow the mailbox asset contract.
- A referenced asset cannot be deleted out of order.
- Plain-text fallback stays equivalent to the sanitized HTML meaning.
- Full-access users can edit; read-only/send-only users cannot.
- New, reply, and forward sends contain one signature in HTML and text—not zero and not two.
- Existing legacy drafts do not gain a duplicate signature.
- Keyboard toolbar operation, focus order, image alt-text entry, status announcements, mobile
  layout, zoom, and reduced motion pass.

### Definition of done

- The editor cannot generate markup the backend unexpectedly removes or reinterprets.
- Saved HTML and plain-text previews match server-canonical output.
- Inline asset lifecycle works without orphaning or prematurely deleting referenced files.
- New mail, replies, forwards, drafts, and queued sends contain exactly one correct signature.
- Full quality, isolated build, staging/production deployment, and real send verification pass
  before F4 is pruned.

---

## Workstream 4 — F7 calendar presentation

### User outcome

Users can view events and tasks together in a chronological agenda, distinguish overdue/open and
completed work, understand that recurrence is not supported, and use all calendar/task/reminder
workflows on keyboard, mobile, tablet, zoomed, and desktop layouts.

### Existing backend contract

Read `docs/CALENDAR_BACKEND.md` completely. Do not add a recurrence facade. The APIs reject a
non-empty `recurrenceRule` because series, occurrence, exception, reminder, and daylight-saving
semantics are not implemented.

Existing client functions are in `src/lib/calendar/client.ts`; shared record types are in
`src/lib/calendar/types.d.ts`.

### Primary files

- `src/app/(dashboard)/calendar/page.tsx`
- `src/app/(dashboard)/calendar/utils.ts`
- `src/components/calendar/calendar-types.d.ts`
- `src/components/calendar/calendar-utils.ts`
- `src/components/calendar/month-view.tsx`
- `src/components/calendar/time-grid-view.tsx`
- `src/components/calendar/calendar-side-panel.tsx`
- `src/components/calendar/event-dialog.tsx`
- `src/components/calendar/task-dialog.tsx`
- `src/components/calendar/tasks-panel.tsx`
- `src/lib/calendar/client.ts`
- Existing calendar unit, UI contract, and integration tests

### Agenda behavior

1. Add `agenda` to the `CalendarView` union and the visible view selector.
2. Define a deterministic agenda range. A rolling range beginning at the selected local day is a
   reasonable default; document the exact range and make previous/next navigation move by that
   same range.
3. Fetch overlapping events and all relevant tasks through existing authorized client functions.
   Do not create a broad unauthenticated aggregate endpoint.
4. Normalize events and tasks into a discriminated frontend agenda item type.
5. Sort chronologically by effective local start/due time, with stable tie-breaking so rerenders do
   not reorder equal timestamps.
6. Group items under semantic date headings in the item's intended timezone.
7. Display all-day items without fabricating a time.
8. Show undated tasks in a separate “No due date” section rather than silently omitting them.
9. Present task state clearly:
   - open and upcoming;
   - open and overdue;
   - completed, including completion state without relying on color or strike-through alone.
10. Preserve event/task click behavior and the existing dialogs, reminder controls, assignment,
    completion, reopening, and activity access.
11. Empty, initial-loading, background-refresh, and error states must be local to the agenda
    surface and compatible with the F2 behavior.
12. Keep the view keyboard shortcut model consistent. Add an agenda shortcut only if it does not
    conflict with inputs or an existing command; advertise it in the control title/help.

### Recurrence communication

- Add concise text in event and task create/edit interfaces: repeating events/tasks are not yet
  supported and each saved item is a single occurrence.
- Do not show a disabled recurrence selector that implies imminent or partially working support.
- Do not send `recurrenceRule` from the UI.
- Do not implement frontend-only duplication as “recurrence.”
- Recurrence can be added only after the backend gains stable series IDs, occurrence IDs,
  exclusions, per-occurrence overrides, reminder targeting, and timezone-safe future
  regeneration.

### Accessibility and responsive requirements

- Agenda date headings form a logical heading hierarchy.
- Each item exposes its type, title, time/date, and state to assistive technology.
- Overdue/completed meaning is conveyed in text, not color alone.
- View switching uses the existing radio-group semantics and includes Agenda.
- Keyboard users can open an item and return focus to the originating agenda row when the dialog
  closes.
- Mobile layouts use readable stacked rows with no horizontal clipping of primary actions.
- Month/week/day retain their existing intentional horizontal-scroll behavior.
- Test 390 px, 768 px, narrow desktop, desktop, and 200% equivalent reflow.
- Preserve reduced-motion behavior and visible focus.

### Tests to add or update

- Agenda range/title/previous/next/today calculations.
- Stable combined event/task ordering.
- Timezone and all-day grouping around midnight and daylight-saving boundaries.
- Open, overdue, completed, and undated task presentation.
- Empty/loading/error/background-refresh states.
- Agenda radio semantics, keyboard navigation, dialog focus return, and mobile reachability.
- Recurrence limitation text appears in both event and task interfaces.
- No frontend request sends a non-empty `recurrenceRule`.
- Existing month/week/day and task/reminder integration tests remain green.

### Definition of done

- Users can understand upcoming events and tasks chronologically from a dedicated agenda view.
- Overdue and completed tasks are unambiguous without relying on color.
- No interface suggests that recurring items are supported.
- Calendar, assignment, and reminder workflows pass responsive and accessibility verification.
- Full quality, isolated build, staging/production deployment, and smoke checks pass before F7 is
  pruned.

---

## Cross-workstream frontend standards

### Data and errors

- Use the existing `authFetch` wrapper and existing typed client modules.
- Do not expose server error objects directly. Present a safe, actionable message while retaining
  detailed diagnostics on the server where appropriate.
- Keep stale usable data visible during refetch.
- Abort or ignore obsolete requests when changing mailbox, route, view, or dialog state.
- Never cache secrets or one-time recovery material in persistent client storage.

### Accessibility

- Native elements first: buttons for actions, links for navigation, labelled fields, semantic
  headings and landmarks.
- Icon-only controls require accessible names; decorative icons use `aria-hidden="true"`.
- Async success uses a polite status region; blocking errors use an alert and receive sensible
  focus.
- Dialogs trap focus correctly and restore it to their opener.
- Do not remove outlines unless a visible `focus-visible` replacement exists.
- Do not add auto-focus that makes mobile pages jump unexpectedly; use deliberate focus only at
  workflow transitions.

### Responsive behavior

- Verify 390 px, 768 px, narrow desktop, standard desktop, 200% equivalent reflow, and large text.
- Required actions must remain reachable without horizontal page scrolling.
- Use intentional inner scrolling for grids or toolbars that cannot remain legible when compressed.
- Respect mobile safe areas for fixed or floating controls.
- Do not disable browser zoom.

### Security

- Server authorization and sanitization remain authoritative.
- Never send TOTP secrets, recovery codes, or mailbox signature images to third-party services.
- Do not use `dangerouslySetInnerHTML` for raw editor or remote content.
- Do not weaken CSP to make a frontend library work.
- Do not add remote script, font, QR, image, analytics, or editor dependencies.

## Quality gate for every completed workstream

Run from `D:\mailflare` without touching the user-managed dev server:

```powershell
npm run check:dependencies
npm run check:environments
npm run format:check
npm run typecheck
npm run typecheck:integration
npm run lint
npm test
npm run test:integration
git diff --check
```

Use Prettier only on files intentionally touched when formatting is needed.

### Isolated Worker build

1. Create a uniquely named release directory outside `D:\mailflare`.
2. Copy the repository snapshot while excluding `.git`, `node_modules`, `.next`, `.open-next`,
   `.wrangler`, and `.dev.vars`.
3. Run `npm ci` inside that release directory.
4. Run `npm run build:worker` there.
5. Do not delete earlier readiness release directories.

### Browser verification

Reuse the running localhost application without managing its process. Verify the workstream with
keyboard and pointer, narrow and desktop widths, 200% equivalent reflow, reduced motion, and the
accessibility tree. Do not use real credentials in test logs or screenshots.

### Deployment

- For Cloudflare deployment work, read the installed Cloudflare, Workers best-practices, and
  Wrangler skill instructions and retrieve current official documentation first.
- Deploy the exact isolated build to staging.
- Run route and behavior smoke checks.
- Promote the same artifact to production only after staging passes.
- Record Worker version IDs and operational evidence in the relevant documentation.
- Confirm no migrations are pending when a workstream touches schema expectations.
- Prune the completed readiness section only after production verification.

## Final completion checklist

Before declaring the frontend complete, verify all of the following:

- [ ] Internal-tool robots/noindex behavior is deployed and F1 is resolved.
- [ ] Secondary requests never restore or prolong a global blocking overlay.
- [ ] MFA enrollment includes local QR generation, manual key, recovery-code acknowledgement, and
      accessible focus/error behavior.
- [ ] Rich signatures round-trip through the backend sanitizer and produce one signature in both
      HTML and plain-text mail.
- [ ] Signature images obey mailbox access, quota, CID, alt-text, and deletion rules.
- [ ] Calendar Agenda combines events and tasks with clear overdue/completed/undated states.
- [ ] Recurrence is explicitly described as unsupported and no UI implies otherwise.
- [ ] Full unit/integration/type/lint/format/dependency/environment checks pass.
- [ ] An isolated OpenNext build passes.
- [ ] Manual responsive, keyboard, focus, and assistive-technology checks pass.
- [ ] The exact verified artifacts are deployed to staging and production.
- [ ] Completed items are documented and pruned from `PRODUCTION_READINESS.md`.
- [ ] Only then is the framework migration gate reconsidered.

