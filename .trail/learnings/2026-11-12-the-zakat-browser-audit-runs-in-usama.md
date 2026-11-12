---
title: 'The zakat browser audit runs in phases, because a saved report blocks the confirmation step'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 22, tokens: 122089 }
id: l-7972efb6
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/responsive.zakat.spec.ts
  - apps/web/src/features/zakat/zakat-history.tsx
  - apps/web/src/features/zakat/goods-table.tsx
---

## Decided

- `responsive.zakat.spec.ts` depends on file order. Seed 1 gives the shop money, two products (one by weight, not yet measured) and a methodology. Group 1 opens everything that exists before a report. Group 2 opens the same pages on a device whose `/api/sync/pull` is aborted (service workers blocked so the route sees the request): no methodology, no records, so the "not set up" overview and every blocked step are measured. Seed 2 saves a report, voids it, saves another and pays a part. Group 3 opens everything after.
- Each seed polls the server until it holds what it made, because every test is a fresh device that pulls.
- `measured()` waits 350 ms before reading: a just-enabled Save button read mid-transition showed a dark-theme contrast of 4.24:1 that is not real.

## Tried and ruled out

- One seed, then everything: once a live report exists for the hawl the confirmation says `already_saved`, so the unblocked layout (ticks, enabled Save, the one gold action) cannot be reached again in the same database.
- Fixing the contrast notes in the zakat feature: the three colour pairs found are shared tokens (`muted-foreground` 4.48:1 on the page and 4.37:1 on cards, `Badge warning` 4.43:1), and tokens change only with the owner's approval.

## Watch out

- The audit adds records to the shared database, so it needs `RESPONSIVE_AUDIT=1` and its own stack. Run the file whole, never by `--grep`.
- On tablet portrait the sidebar leaves a 486px panel. The history table was 536px wide there, which pushed its Details link out of view; wrapping its two sub-lines and narrowing the link fixed that. The inventory table (6 columns) still scrolls inside its own panel at that width; the page never scrolls sideways.

In the code: `apps/web/e2e/responsive.zakat.spec.ts`, `responsive-run.ts`, `zakat-kit.ts`, `apps/web/src/features/zakat/zakat-history.tsx`, `goods-table.tsx`.
