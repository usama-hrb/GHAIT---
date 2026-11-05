---
title: "The movement history's day filter reads the day the list shows, not the movement's business date"
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 13, tokens: 86803 }
id: l-f3d8b972
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/inventory/movement-filter.ts
  - apps/web/src/features/inventory/movement-filter.test.ts
  - apps/web/src/i18n/en.ts
  - apps/web/src/i18n/ar.ts
  - apps/web/src/features/inventory/movement-filter-bar.tsx
---

## Decided

- The days-from/to filter compares the shop day of each movement's `createdAt` (Casablanca time, via `shopDate`), because that is the timestamp the date column displays. Filtering on `date` (the business date) would hide a backdated purchase on the day it is listed under and show it on another.
- Batches in the filter are listed in the order they were bought (oldest movement first), not sorted by code: batch codes are not in purchase order.
- Filtering is presentation only (type, batch, day). It lives in the inventory feature as pure functions and calls no stock math, so it stays out of `@fabric/core`.

## Watch out

- Casablanca is UTC+1 all year except Ramadan (UTC+0), so a test that expects "winter = UTC" is wrong outside Ramadan; use January or July, not "winter".
- A new filter resets the "show full history" toggle, otherwise a short filtered list hides the button that closes it and the cleared history stays expanded.

In the code: `apps/web/src/features/inventory/movement-filter.ts` (+ test), `movement-filter-bar.tsx`, `movement-history.tsx`; e2e in `e2e/product-workspace.spec.ts`.
