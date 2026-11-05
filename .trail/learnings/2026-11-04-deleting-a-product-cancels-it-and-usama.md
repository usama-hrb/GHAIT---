---
title: 'Deleting a product cancels it, and only once it holds no stock'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 19, tokens: 308170 }
id: l-1e6ee96f
scope: repo
status: active
src: agent
touches:
  - apps/api/test/product-removal.e2e-spec.ts
  - apps/web/e2e/product-removal.spec.ts
  - apps/web/src/local-db/product-inventory.ts
  - apps/web/src/local-db/product-inventory.test.ts
  - docs/adr/0013-removing-a-product.md
  - apps/web/src/i18n/ar.ts
  - CLAUDE.md
  - apps/web/src/shared/brand/void-dialog.tsx
  - apps/web/src/local-db/tables.ts
---

## Decided

- "Delete product" in the Inventory is a cancellation (void with a required reason), never an erase: the database refuses DELETE and CLAUDE.md forbids hard deletes, and past sales, returns and reports still read the product by id. Nothing cascades; photos are left as they are.
- A product may be cancelled only when it holds no stock (no available quantity, no weight awaiting a length, no cost left on a batch). A cancelled product with stock would drop out of the stock value with no sale or loss to explain it, so the owner records the loss or sale first. We did not auto-write a loss: that invents an accounting entry the owner never chose.
- The server enforces it too, through a per-entity void guard in the sync registry that the stock module fills in. It runs for the REST route and for a pushed void op, so an offline device cannot sneak a product with stock past it. A stale device is rejected and the owner sees it in the sync issues.
- Recorded as assumption PB20 and ADR 0013.
  In the code: `productHoldsStock` (packages/core stock), `checkProductRemoval` (contracts stock), `SyncRegistry.addVoidGuard` (api sync registry), `StockService.assertProductRemovable`, `ProductInventoryRepository.remove` (web local-db), `RemoveProductDialog`.

## Tried and ruled out

- A real DELETE with cascades: forbidden by the row guards and would orphan batches and break period-locked history.
- Placing the guard in the catalog module: batches belong to stock, so it would need stock internals. The registry hook keeps the module boundaries.

## Watch out

- `LocalStore.deviceId()` caches its promise and opens its own transaction. Called for the first time inside a transaction that lacks the `meta` table, it fails with "Table meta not included in parent transaction" and the failed promise stays cached. A repository method that wraps `void()` in its own Dexie transaction must `await store.deviceId()` first. Unit tests missed it because the earlier seeding had already cached the id; only a fresh page load offline hit it (regression test: "works as the first change after the app is reopened").
- The en and ar catalogs must list keys in the same order, not just the same keys; catalogs.test.ts fails otherwise.
- shadcn `Alert` always has role="alert", so a test that looks for "the warning" by role also finds the plain info box. And an open modal hides the page behind it from role queries (`includeHidden: true`).
