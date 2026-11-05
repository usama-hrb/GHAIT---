---
title: 'Add stock asks for the cost of one unit for every unit; the total is worked out in core, not typed'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 6, tokens: 79734 }
id: l-6c77a972
scope: repo
status: active
replaces: l-6c3d4853
src: agent
touches:
  - packages/core/src/costing/purchase.ts
  - apps/web/e2e/helpers.ts
  - docs/accounting-assumptions.md
---

## Decided

- Add stock and the product form's first stock ask for the price of one metre, one kilo or one piece. The total is price × quantity from core: `meterPurchaseCostCents` and `weightPurchaseCostCents` round half up to the cent, `piecePurchaseCostCents` is exact. The kilo follows the rule the metre already had, so one rounding mode serves every unit and the totals stay explainable.
- Only `totalCostCents` is stored and synced. The typed price lives in the form draft (`unitCostCents`), so contracts, API, sync and the DB are unchanged. A batch's cost per kilo or piece is derived as total ÷ quantity and can differ from what was typed by under a cent.
- Changing the unit clears the typed price: a price per metre is not a price per kilo.

## Tried and ruled out

- Keeping a total field for kg and pieces beside the unit price: two cost fields can disagree, and the user asked to replace the total.

## Watch out

- The e2e helper `fillStock` types `cost` as rial per unit (metre, kilo or piece) for every unit. A spec written with a whole-purchase total must divide it: 20 kg for 8,000 rial is typed as 400 rial a kilo; 10 pieces for 2,000 rial as 200 a piece.
- In the draft, read the total with `totalCostOf(draft)`; there is no total field any more.
  In the code: apps/web/src/features/inventory/stock-fields.tsx (totalCostOf, COST_FIELD), packages/core/src/costing/purchase.ts, apps/web/e2e/helpers.ts, docs/accounting-assumptions.md (PB21).
