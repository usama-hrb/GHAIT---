---
title: 'A selling line priced by its total is turned into a per-unit price in core, and dialog footers sit flush with the dialog edge'
author: Usama
date: 2026-11-14
branch: main
cost: { minutes: 66, tokens: 422445 }
id: l-525352f3
scope: repo
status: active
src: agent
touches:
  - packages/core/src/pricing/index.ts
  - apps/web/src/features/pos/line-dialog.tsx
  - apps/web/src/shared/ui/dialog.tsx
  - apps/web/src/features/inventory/product-header.tsx
---

## Decided

- "I paid 145.20 for 3 m" is typed as the line total, then divided into a per-unit price by `unitPriceForLineTotal` in `packages/core/src/pricing/index.ts` (half-up, per meter or per piece). The sale line stays priced per unit; no fixed-total line type exists. A line total is always `round(price x cm / 100)` and the whole-piece price is only for an untouched whole piece, so a stored fixed total would have broken both rules. The dialog shows the rounded total back so the owner sees any cent of difference (assumptions LT1, LT2).
- The POS dialog uses a Checkbox (not a Switch) for "enter the total price": `min-price.spec.ts` counts `role=switch` in the dialog and expects only the whole-piece switch.
- `DialogFooter` uses `sticky -bottom-4`, not `bottom-0`: a sticky footer stays inside the dialog padding, so `bottom-0` left a 16px strip under every dialog footer.

## Tried and ruled out

- A total field beside the price field: two fields to keep in step, and the cashier does not know which one wins.

## Watch out

- The responsive audit needs `RESPONSIVE_AUDIT=1` and both specs together (`responsive.spec responsive.workflows`); the workflows spec alone has no products to open.
- "Command palette with the keyboard up" at phone-320 (en) fails without any of this change (132..476 of 396); it is a separate, older issue.
- In the product header, the action group must wrap (`flex-wrap`) or the Arabic labels push the page 2px wider than 320 px.
  In the code: `apps/web/src/features/pos/line-dialog.tsx`, `apps/web/src/shared/ui/dialog.tsx`, `apps/web/src/features/inventory/product-header.tsx`.
