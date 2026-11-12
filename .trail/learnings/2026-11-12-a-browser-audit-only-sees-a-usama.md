---
title: A browser audit only sees a short link if its seed sale has reached the server
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 18, tokens: 188159 }
id: l-b6df2331
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/integrity/latest-changes.tsx
  - apps/web/src/features/integrity/latest-changes.test.tsx
  - apps/web/e2e/responsive.integrity.spec.ts
  - docs/adr/0027-financial-integrity-screen-and-grouped-navigation.md
  - apps/web/e2e/settlements.spec.ts
  - apps/web/e2e/responsive-kit.ts
---

## Decided

- The integrity page's browser audit waits, at the end of its seed, until the server holds the sale and its payment. Every device the audit opens afterwards is a fresh browser that pulls from the server, so a sale that is still in the seeding device's outbox never shows up in the lists the audit measures.
- The name of a change that opens a record has a minimum link size in both directions: 24 px for a mouse and 44 px for a finger. A one-word name is only as wide as the word: "Sale" is 29 px and the Arabic "بيع" is 18 px.

## Tried and ruled out

- Trusting the first green run. The audit passed with the narrow link in place, because the seed sale was never pulled and the list held only the long "Stock purchase" names. Removing the fix on purpose and rerunning is what showed the audit could not see the defect, and it failed at once after the seed waited.
- Widening the link for touch only. The desktop run in Arabic still failed at 18 px, so the mouse needs its own minimum.

## Watch out

- Any audit that depends on a record being present on a fresh device needs the same wait for the server to hold it. A passing audit says nothing about a state it never showed.

In the code:

- `apps/web/e2e/responsive.integrity.spec.ts`: the seed test polls `serverCount(request, 'sale')` and `serverCount(request, 'payment')` before it ends.
- `apps/web/src/features/integrity/latest-changes.tsx`: the record link carries `min-h-6 min-w-6 pointer-coarse:min-h-11 pointer-coarse:min-w-11`; `latest-changes.test.tsx` asserts all four in English and Arabic.
