---
title: 'Add stock by the metre takes the price of a metre; the total is worked out in core, not typed'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 9, tokens: 140340 }
id: l-6c3d4853
scope: repo
status: active
src: agent
touches:
  - packages/core/src/costing/purchase.ts
  - apps/web/e2e/helpers.ts
---

## Decided

- A length purchase (unit meter) in the Add stock dialog and the product form's first stock is typed as the price of one metre. The total is price x length in cm / 100, rounded half up, from `meterPurchaseCostCents` in core. This is the SPEC section 2.3 rule that `buildRollsFromPurchase` already used, so `buildRollsFromPurchase` now calls the same function and there is one copy of it.
- A weight or pieces are still typed as a total cost. A price per metre means nothing for them.
- Only `totalCostCents` is stored and synced. The typed price lives only in the form draft (`costPerMeterCents`), so contracts, API, sync and the DB are unchanged. A batch's cost per metre is derived as total / length, so it can differ from what was typed by under a cent when the total was rounded (PB19 in accounting-assumptions).

## Tried and ruled out

- Keeping the total field and adding a per-metre helper beside it: the user asked to replace it, and two cost fields can disagree.

## Watch out

- The e2e helper `fillStock` types `cost` as rial per metre for a meter entry and as the whole purchase for kg and piece. A spec that used a total for a length must now divide it, e.g. 2.3 m for 2,000 rial is typed as 869.6 rial a metre (4348 cents x 230 / 100 = 10000.4, so 10,000 cents).
- In the draft, `totalCostCents` is only read for kg and piece. Use `totalCostOf(draft)`, never the field, to get a length's total.
  In the code: apps/web/src/features/inventory/stock-fields.tsx (totalCostOf, costFieldOf), packages/core/src/costing/purchase.ts, apps/web/e2e/helpers.ts.
