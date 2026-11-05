---
title: 'Inventory is about stock and cost, not selling price: average cost is the cost left on the batches over what is left'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 13, tokens: 175042 }
id: l-6e89fbc4
scope: repo
status: active
replaces: l-14f2b68b
src: agent
touches:
  - apps/web/src/features/inventory/product-inventory-screen.tsx
---

## Decided

- The Inventory shows what the shop holds and what it cost: available, weighted average purchase cost, stock value, status and batches. Selling and minimum prices are not shown there (they stay in the product form, the till and the minimum-price check). Reason: the owner reads this screen to know what is on the shelf and what it is worth, not what it sells for.
- Stock value is the sum of each batch's remaining cost (`unallocatedCostCents`), the same figure the stock report uses, so sales, losses and returns are already off and no product-level cost replaces a batch's own cost. The average per metre (and apart per piece) is that remaining cost over the remaining quantity, rounded half up once, in a new core function `productStockValue` (rule PB18). Reason: averaging by batch count or taking the newest cost is wrong when batches cost different amounts.
- Weight still awaiting a length counts in the value and stays out of the per-metre average, which shows a dash when no length is held. Reason: a cost per metre for an unmeasured weight would be invented.
- Each batch's original cost is read in a Batches popover on the row or card; the table is the default view from 1280px, narrower screens get compact cards (the 7-column table collapsed the product column on a tablet).
- Add Stock from a row opens the existing restock dialog in place. Reason: a `?restock=1` link would not match the precached page offline, since the service worker only ignores `?id=`.

## Tried and ruled out

- Photo tiles as the default list (the previous decision): replaced; the stock and cost columns need a table, and the tiles carried selling prices.

## Watch out

- In the code: `packages/core/src/products/stock.ts` (`productStockValue`), `apps/web/src/local-db/product-inventory.ts` (`stockValueCents`, `averageCostPerMeterCents`, `remainingCostCents`; mapping only), `apps/web/src/features/inventory/product-inventory-screen.tsx`, `batch-list-popover.tsx`, `inventory-view.ts` (default `table`). A cashier's batches are redacted, so these figures are hidden by `useCanSeeCosts`, not computed for them.
