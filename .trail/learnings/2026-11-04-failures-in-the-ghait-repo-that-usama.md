---
title: 'Failures in the GHAIT repo that exist at HEAD and are not from inventory work: token…'
author: Usama
date: 2026-11-04
id: l-cfca1c40
scope: repo
status: active
touches:
  - apps/web/src/app/tokens.contrast.test.ts
  - CLAUDE.md
  - apps/web/e2e/language.spec.ts
---

## Decided

As of 2026-11-03 these are red at HEAD (commit e5a6a48 "Pos refectoring") and have nothing to do with the product/inventory refactor. Re-check before relying on this; the owner may have fixed them.

- `apps/web/src/app/tokens.contrast.test.ts`: 11 cases fail (muted-foreground, warning/warning-foreground, debt, input, dark estimated). CLAUDE.md says never to lower the thresholds; tokens change only with the owner's approval.
- e2e `apps/web/e2e/language.spec.ts` is stale: the header language control is now a single "Switch to English/Arabic" button (commit e5a6a48), while the spec looks for a "Language" menu with `menuitemradio`; it times out at 60 s. The only red test of `pnpm --filter @fabric/web test:e2e` (23 of 24 pass, 2026-11-03).
- e2e `payInFull` was stale for the same reason (the Pay button saves a paid-in-full sale directly, no dialog, no page change); fixed on 2026-11-03 in the inventory work: helpers now wait for the bill to empty and open the sale from `/pos/history` (`openLastSale`).
- `apps/web` lint: 5 errors + 1 warning in `app/(shop)/layout.tsx` (unused SignOutButton), `shared/brand/app-shell.tsx` (boundaries), `shared/language/language-toggle.tsx`, `shared/theme/theme-toggle.tsx`.
- `make deps`: 3 violations, `shared/brand/app-shell.tsx` imports `features/sync` (web-shared-never-imports-features, plus the cycle through `shared/brand/index.ts`).
  …

## Watch out

when `make check` or e2e is red, compare against this list before assuming a new change broke it; mention the items in reports without touching them unless asked.

_From Claude Code's memory of this repo, last updated Nov 3._
