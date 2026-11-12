---
title: 'The responsive audit runs both specs together and measures the DOM, never screenshots'
author: Usama
date: 2026-11-11
branch: main
cost: { minutes: 77, tokens: 217312 }
id: l-64b93aac
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/responsive-kit.ts
  - apps/web/src/features/customers/invoice-list.tsx
  - apps/web/src/shared/ui/table.tsx
  - apps/web/src/features/customers/payment-list.tsx
---

## Decided

- `e2e/responsive.spec.ts` (every route) and `e2e/responsive.workflows.spec.ts` (every dialog, drawer and menu) run only with `RESPONSIVE_AUDIT=1`. Run them together: the workflows spec relies on the data that the routes spec seeds first. `RESPONSIVE_SOFT=1` records findings in the JSON reports under `RESPONSIVE_REPORT` instead of failing; `RESPONSIVE_SIZES` and `RESPONSIVE_LANGS` narrow a run.
- It measures the page in the browser (sideways scroll, controls off screen, clipped text, targets under 44 pixels on touch, a focused field hidden with the keyboard up) because the owner checks looks by eye and wants no screenshots.

## Tried and ruled out

- Pressing Escape twice to close an overlay: on a phone it also closed the bill drawer behind the dialog and the rest of the flow waited for a button that was gone. A dismiss now closes one layer, and the till flow reopens the bill drawer before each action, because the app closes it when something is opened from the bill.
- Waiting for controls with no time limit: one wrong locator stalled the whole run for seven minutes. The page now has a 15 second default timeout, so a missing control becomes a "flow stopped" note.

## Watch out

- Playwright focusing a `type="date"` field does not scroll it into view in this emulation, so the keyboard-up check scrolls the field itself, as a phone does.
- A field legitimately scrolls its own text, so inputs are excluded from the clipped-text finding.
  In the code: `apps/web/e2e/responsive-kit.ts`, `responsive.spec.ts`, `responsive.workflows.spec.ts`.
