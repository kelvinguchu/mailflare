# Accessibility and responsive verification

Last verified: 2026-09-15

## Supported behavior

- A skip link is the first focusable control and moves focus to the stable `main-content` target.
- Dashboard, settings, administration, and authentication shells expose one main landmark.
- The sidebar defaults to a compact rail below 768 px. Opening it on a narrow screen does not change the saved desktop preference.
- Keyboard focus is visible globally, including mail search, navigation, compose, conversation, settings, and calendar controls.
- Motion is reduced to effectively instantaneous transitions and animations when `prefers-reduced-motion: reduce` is active.
- Search and compose fields have programmatic labels, durable names, and appropriate autocomplete, input-mode, and spellcheck behavior.
- Opening the floating composer focuses the recipient field. Closing it restores focus to the control that opened it.
- Conversation expansion and collapse use native buttons. Contact-detail controls are not nested inside another interactive control.
- Settings navigation becomes a horizontally scrollable, keyboard-reachable strip below the desktop breakpoint.
- Month, week, and day calendar grids retain usable column widths and scroll horizontally on narrow screens.
- Fixed compose surfaces account for mobile safe areas, and their action row wraps without hiding Attach, Undo Send, or Send.

## Automated enforcement

`eslint.config.mjs` promotes focused `jsx-a11y` rules to errors for accessible names, labels, keyboard interaction, focusability, landmarks, and valid tab order.

`tests/accessibility-contracts.test.ts` protects the critical structural contracts:

- skip link and protected/auth main landmarks;
- global focus, touch, and reduced-motion fallbacks;
- accessible mail search and compose fields;
- compose focus entry/return and narrow action wrapping;
- semantic conversation controls;
- responsive settings and calendar structures;
- responsive sidebar preference isolation; and
- semantic mail-folder navigation progress.

## Manual browser pass

The pass used Chrome's accessibility tree, keyboard navigation, computed styles, and screenshots against the user-managed local server. No development server was started, stopped, or restarted.

| Surface                | Widths checked                                 | Result                                                                                                                                                          |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication         | 390 px and desktop                             | Main landmark, field labels, recovery link, and submit control are exposed. Recovery-link contrast is 5.24:1.                                                   |
| Inbox and conversation | 390 px and desktop                             | Compact navigation, search, message links, selection, actions, expand/collapse, reply, and forward remain reachable.                                            |
| Compose                | 390 px, 768 px, and desktop                    | Focus enters To, all fields are named, actions wrap, and focus returns to Compose on close.                                                                     |
| Settings               | 390 px and 768 px                              | All settings destinations remain in the accessibility tree and the mobile navigation strip scrolls without clipping the page content.                           |
| Calendar               | 390 px and desktop                             | View controls, date navigation, create actions, event slots, tasks/reminders sheet, and grid cells are keyboard-addressable. Narrow grids scroll intentionally. |
| Administration         | Shared shell at narrow and desktop breakpoints | Navigation and mailbox selection use semantic controls; the mailbox selector is in document flow and cannot overlap narrow content.                             |

The direct `/admin` and `/operations` refresh checks remained behind the existing full-screen data-loading gate in the development session. That gate is tracked separately by production-readiness item F2. Admin shell semantics and responsive behavior are covered by lint, source contracts, type checks, and the isolated production build.

At 200% equivalent reflow, required actions remain present and long content wraps or is available through an intentional scroll container. Browser zoom is not disabled by viewport metadata. The representative auth palette passes WCAG AA contrast for normal text; the smallest recovery link was raised from 2.39:1 to 5.24:1 during this pass.

## Deployment verification

The UI-only release required no database migrations. The same isolated OpenNext artifact was deployed and smoke-tested on 2026-09-15:

- Staging: Worker version `9fb54f37-2127-4b86-86e2-67f7a0736ce1`; `/login` returned HTTP 200 with the skip link and `main-content` target.
- Production: Worker version `a1d522b7-5217-4af1-8c4e-bca4064899bb`; `https://mail.calibercode.io/login` returned HTTP 200 with the same accessibility landmarks.

## Reverification checklist

1. Run strict lint, source and integration type checks, unit tests, and integration tests.
2. Build from an isolated release directory so the working tree's `.next` and `.open-next` directories are untouched.
3. In a browser, Tab to the skip link, activate it, and confirm focus lands on main content.
4. Open and close Compose from the keyboard; confirm recipient focus on open and opener focus on close.
5. Exercise a message conversation, settings navigation, calendar view controls, and an admin navigation link without a pointer.
6. Inspect the accessibility tree for names, headings, alerts, statuses, progress, dialogs, and live regions.
7. Check 390 px, 768 px, narrow desktop, and desktop widths, then verify 200% equivalent reflow and reduced-motion styles.
