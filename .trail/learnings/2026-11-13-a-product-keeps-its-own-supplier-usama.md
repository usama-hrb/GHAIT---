---
title: "A product keeps its own supplier list, and the cashier's copy of it is emptied"
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 30, tokens: 325709 }
id: l-48c0b558
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/inventory/product-suppliers.tsx
  - apps/web/e2e/product-suppliers.spec.ts
  - docs/adr/0015-supplier-workspace.md
  - packages/contracts/src/reports.test.ts
  - packages/contracts/src/products.ts
  - packages/contracts/src/access.ts
  - apps/web/src/local-db/upgrade.ts
  - apps/web/src/local-db/product-inventory.ts
  - apps/web/src/features/inventory/product-detail-screen.tsx
---

## Decided

- Put the suppliers a product is bought from on the product itself as `supplierIds` (an array of supplier ids), not in a new synced join entity. It is a list of a few ids, always read with its product, and nothing in purchases, costs or debts depends on it.
- A cashier never sees a supplier (SPEC §11), so `product` became a `redacted` entity for cashiers: their device receives the product with `supplierIds: []`. Redaction on the API keeps the supplier ids out of the cashier's pull entirely; hiding the section in the UI alone would have left them in the cashier's local database.
- Add `supplierIds` to existing products on devices with a Dexie upgrade (version 17), because the server's product rows did not change sequence and no pull would bring the new field. Writing `?? []` at every reader was the alternative and was dropped.
- Every internal product save goes through `inputOf` (build the full input from the stored record). The product form dialog builds its input by hand, so it must pass `supplierIds` on, otherwise editing a product silently wipes its suppliers.
- "Edit stock" on the product page opens the existing stock count (an `adjustment` move). Stock is never edited in place.
- A new purchase starts with the product's supplier only when the product has exactly one; a supplier the user already picked, or "none", is never replaced.

## Tried and ruled out

- A `product_supplier` synced entity: needs its own handler, Dexie table, lock dates and cashier rule for a few ids.
- A foreign key from `product.supplier_ids` to supplier: Postgres has none for array elements. Suppliers are only cancelled, so the page leaves a cancelled one out instead.

## Watch out

- The API e2e suite run in parallel is flaky on this machine (three runs: 4 failures in control-database setup, then 1 failure reading a sale after a legacy import, then none). Each file passes alone and `--no-file-parallelism` gives 492/492. Do not read one red parallel run as caused by the change before running the failing file alone.
- Test fixtures that build a `Product` by hand need `supplierIds: []`. Vitest does not typecheck, so only `typecheck` finds a missing one.

In the code: `packages/contracts/src/products.ts`, `packages/contracts/src/access.ts` (`redactForRole`), `apps/api/drizzle/0035_product_suppliers.sql`, `apps/web/src/local-db/upgrade.ts` (`upgradeToProductSuppliers`), `apps/web/src/local-db/product-inventory.ts` (`inputOf`, `setSuppliers`), `apps/web/src/features/inventory/product-suppliers.tsx`, `docs/adr/0015-supplier-workspace.md` (amendment).
