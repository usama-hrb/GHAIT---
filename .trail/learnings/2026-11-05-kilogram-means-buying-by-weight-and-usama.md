---
title: 'Kilogram means buying by weight, and the unit switches gate new work in the interface but never sync'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 2910 }
id: l-4d6d3b08
scope: repo
status: active
src: agent
touches:
  - docs/accounting-assumptions.md
  - apps/web/src/features/pos/catalog-panel.tsx
  - apps/web/src/features/inventory/stock-fields.tsx
---

## Decided

- The three shop switches (Unit / Piece, Kilogram, Meter) are the server-owned setting `selling_units`, at least one on, default all on. Unit and Meter decide what can be sold. Kilogram decides whether the shop can buy and stock by weight. The owner chose this over making kilogram a selling unit, because that needs a new sale unit in the accounting core and a ledger migration. PB7 and migration 0027 stay as they were.
- The switches gate only new work in the interface (POS tiles and line dialog, product form, restock panel). The server checks that one unit is on and that the writer is the owner, and never rejects a synced record because a unit is now off, so a device that was offline when a unit was switched off can still push valid earlier work.
- The safe-disable guard is advice on the device, not a server rule, for the same reason: it blocks a change that would leave an active product with no unit it can be sold in, and only notes a product that can no longer be restocked.

## Tried and ruled out

- A server-side check of units on every synced record: it would reject offline records that were valid when written.

## Watch out

- Accounting logic stays in `packages/core`; none of this touches it. Rows SU1 to SU5 in `docs/accounting-assumptions.md` record the semantics; do not build on a different reading of kilogram without the owner.

In the code: `packages/contracts/src/selling-units.ts`, `apps/web/src/features/settings/selling-impact.ts`, `isSellable` in `apps/web/src/features/pos/catalog-panel.tsx`, `apps/web/src/features/inventory/stock-fields.tsx`.
