---
title: "A POS cart line's stock hold is per batch across all products, so a proposal must only get holds on batches it was offered"
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 8, tokens: 116814 }
id: l-c2bb6b06
scope: repo
status: active
src: agent
touches:
  - apps/web/src/local-db/sales.ts
  - apps/web/src/features/pos/cart.ts
  - apps/web/src/features/pos/line-dialog.tsx
---

## Decided

- `SalesRepository.propose` keeps only the cart holds whose batch it just read for the product being proposed, and turns those into synthetic cart moves. The bill's holds are keyed by batch id over EVERY product on the bill (`heldByBill` in the POS cart), so the dialog hands over foreign batches by design. Filtering in the repository keeps the dialog simple and the core guard untouched.
- The core guard "stock movement X references an unknown batch" (and "a sale proposal cannot mix product ids") stays. It was right: it caught a move on another product's batch. A new core test pins both throws.
- A hold on a batch of the same product that has since run out or is unreadable is also left out, not an error: only batches still on the shelf can be taken from.

## Tried and ruled out

- Reading `cart-0` in the error as a batch id. It is the synthetic move's own id (it used to be `cart-<index>`); the unknown batch was the move's `batchId`. Moves are now named `cart-<batchId>`, so the message names the batch.
- Fixing it in core by skipping unknown batches or widening the batches it takes: that would hide a real data-wiring mistake (a sale move on a batch of the wrong product).
- Scoping `taken` in `LineDialog` by the dialog's product: the dialog does not know which batches are readable now; the repository does.

## Watch out

- The bug only showed with the AUTO batch choice. A manually chosen batch skips `propose`, so it never crashed.
- Any new caller of `propose` must pass holds for the whole bill, not only for the product: stock held by other lines of the same product must still reduce what is offered.

In the code: `apps/web/src/local-db/sales.ts` (`propose`, `cartSale`), `apps/web/src/features/pos/cart.ts` (`heldByBill`), `apps/web/src/features/pos/line-dialog.tsx`, `packages/core/src/products/stock.ts` (`proposeProductStockSale`). Tests: `local-db/sales.test.ts` "proposing a line next to the rest of the bill", `features/pos/cart.test.ts`, `e2e/pos.spec.ts`.
