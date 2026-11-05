---
title: 'The owner confirms selling under the minimum and under the cost once each, on the line, tied to the price'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 28, tokens: 424288 }
id: l-4e9f639f
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/pos/cart.ts
  - docs/accounting-assumptions.md
  - apps/web/src/features/pos/line-dialog.tsx
---

## Decided

- The owner's two confirmations are asked in the line dialog where the price is typed, one strip per rule, and a confirmation is valid only for the unit and exact price it was given at. Any other price, even the same one typed back, drops it. This fixes a switch that stayed on after the price changed and a line under both rules that asked again at payment.
- Payment asks for the below-cost confirmation only for what no line could: a below-cost line nobody confirmed, or a discount that takes the invoice under its cost. Otherwise the sale is saved with `confirmedBelowCost` equal to "the invoice is under its cost".
- Selling screens show no profit to any role. Authorization is shown as a status ("confirmed by owner"), never as an amount. Profit stays on the sale page, history, reports, Home and settlement.
- Why: a confirmation for 340 is not one for 300, the override is recorded per line with the price it went at, and only the payment sees a discount typed after the lines.
- In the code: `priceKeyOf` and `needsCostConfirmationAtPayment` in `apps/web/src/features/pos/cart.ts`; `LineDialog`, `Authorization` and `ConfirmSwitch` in `apps/web/src/features/pos/`; ADR 0019 and rows PA1 to PA4 in `docs/accounting-assumptions.md`.

## Tried and ruled out

- A `confirmedBelowCost` per line in the contract: it changes the sale's schema and sync for a rule the invoice-level flag (P8) already enforces.
- A server-issued authorization token: offline sales cannot wait for a round trip.
- Keeping the confirmation only at payment: the owner would confirm before seeing the discount.

## Watch out

- `CartItem.belowCostConfirmed` is screen state, never sent. Server checks (minimum from its own product record, override names the signed-in owner, cashier push refused with `confirmedBelowCost`) stay the authority.
- The Add button is also disabled while the line is being priced: `useLiveQuery` can hold the previous line's answer, and a late cost confirmation would be asked twice.
- A cashier's device has no costs, so only the server catches a product whose minimum is below its cost.
