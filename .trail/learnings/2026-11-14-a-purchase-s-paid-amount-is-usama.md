---
title: "A purchase's paid amount is corrected in place, not by a new record"
author: Usama
date: 2026-11-14
branch: main
cost: { minutes: 33, tokens: 544610 }
id: l-0b2ad583
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/product-suppliers.spec.ts
  - packages/contracts/src/purchasing.ts
  - packages/contracts/src/sync.ts
  - apps/api/src/modules/purchasing/purchase.repository.ts
  - apps/web/src/local-db/tables.ts
  - apps/web/src/local-db/purchases.ts
  - apps/web/src/local-db/product-inventory.ts
  - docs/adr/0015-supplier-workspace.md
  - docs/accounting-assumptions.md
  - apps/web/src/local-db/react.tsx
---

## Decided

- The owner fixes "what was paid when the purchase was made" by changing `paidCents` on the purchase row itself. Every reader (supplier account, day cash count, integrity check, zakat) already uses that field, so all of them follow with no change. Only `paidCents` (and the supplier, where the purchase had none) may change; a supplier is never swapped.
- `purchase` stays `append_only` and gets a new sync capability `amend: true`: it accepts an `upsert` of its own existing record (never creates or voids one) through the handler's `write`. A missing row is refused with `not_found`. The last-write-wins rule, the period lock and an `update` audit entry with before and after apply as for any mutable entity. `product_batch` already has the same shape for its remnant mark.
- Works offline: the device writes the record and the outbox op in one local transaction, and checks with the same `checkPurchaseAmend` the server runs.
- Raising paid above what a later payment covered is allowed and shows as an advance; the dialog says so. A locked month needs an unlock first.
- The restock form no longer reads an empty paid field as "paid in full": it asks "Paid in full" or "Paid part, the rest is owed", and the amount is required for the second. That empty-field default is how the 1,000 of 5,000 dh slip happened.

## Tried and ruled out

- A REST route that works only online: a correction made at the till without a connection would be lost.
- A `purchase_correction` entity applied at read time: every reader of `paidCents` would have to learn it, and two answers would exist until they all did.
- Making `purchase` a mutable entity: it would also let its stock-bearing fields change.

## Watch out

- A Dexie live query only follows the reads it makes before its first await on something that is not a Dexie read, in the browser. `ProductInventoryRepository.detail()` first read `purchases` after `await this.read()`, so the owed badge on the product page did not refresh when a purchase was corrected while the page was open. It passed in vitest with fake-indexeddb and failed only in Playwright. Read every table the view depends on in the first `Promise.all`.
- Dexie `purchases` has no `supplierId` index (`'id, date, createdAt'`); `.where('supplierId')` on it throws at run time and tsc cannot see it. Use `.filter`. `supplierPayments` does have the index.
- `supplierAccountOf` and core refuse a purchase paid beyond its total with a RangeError: `previewPayment` returns the issues with zero figures before calling it.
- In `ar.ts` an issues map indexed by an arbitrary string needs `as Record<string, string>`; the same cast in `en.ts` fails `no-unnecessary-type-assertion`.
- API e2e files run in parallel are flaky on the shared dev Postgres; `--no-file-parallelism` is clean.

In the code: `packages/contracts/src/purchasing.ts` (`checkPurchaseAmend`), `packages/contracts/src/sync.ts` (`amend`), `apps/api/src/modules/purchasing/purchase.repository.ts` (`amend`), `apps/web/src/local-db/tables.ts` (`PurchasePaymentTable.setPayment`), `apps/web/src/local-db/purchases.ts` (`previewPayment`), `apps/web/src/local-db/product-inventory.ts` (`detail`), `docs/adr/0015-supplier-workspace.md` (amendment 2026-11-14), `docs/accounting-assumptions.md` (SP9).
