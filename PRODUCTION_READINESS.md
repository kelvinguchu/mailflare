# CC Mail — Remaining Production Readiness Work

Last pruned: 2026-09-15

This file contains only work that is still incomplete or still requires deployment verification.
Completed phases, decisions, and progress logs have been removed.

## F1 Complete post-deployment authentication checks

- [ ] Add and verify the URL-prefix property `https://mail.calibercode.io/` in Google Search Console.
- [ ] Verify its Security Issues report; if a warning is present, fix the underlying issue and request provider review.

The deployed authentication design and public Safe Browsing status have been verified. Evidence
and the remaining Search Console prerequisite are recorded in
`docs/AUTHENTICATION_DEPLOYMENT_VERIFICATION.md`.

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
