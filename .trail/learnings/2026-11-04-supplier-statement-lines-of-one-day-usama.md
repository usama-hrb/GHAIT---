---
title: 'Supplier statement lines of one day keep the order they were recorded, and the supplier account carries its own totals'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 43, tokens: 704488 }
id: l-1348a8c5
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/zz-suppliers-shots.spec.ts
  - apps/web/src/local-db/supplier-accounts.ts
  - apps/web/src/local-db/supplier-accounts.test.ts
  - apps/web/src/features/payables/supplier-view.ts
  - apps/web/src/features/payables/supplier-view.test.ts
  - apps/web/src/features/payables/supplier-parts.tsx
  - apps/web/src/features/payables/supplier-dialog.tsx
  - apps/web/src/features/payables/supplier-payment-dialog.tsx
  - apps/web/src/features/payables/suppliers-screen.tsx
  - apps/web/src/features/payables/supplier-header.tsx
---

## Decided

- The supplier account from the core package carries total purchases, total paid and where each payment went (an advance is a part with no purchase). The supplier screens read these and add nothing up, so the profile figures, the payment preview and the shared statement cannot disagree.
- Statement lines of one day and one kind keep the order they are given. The contracts layer gives purchases and payments in the order they were recorded (created time, then id). Before this, same-day payments sorted by random id and the "We owe after" column read out of order, while the "Latest payments" list read in recording order.
- A supplier is archived only when nothing is owed and no advance is held: archived suppliers drop out of the payables, so archiving an owed one would hide a debt from the directory, zakat base and integrity check.
- The directory lists every supplier, not only those owed, so a settled supplier can still be found and paid in advance later.

## Tried and ruled out

- Re-ranking same-day events in the web activity view only: it fixed the activity list but left the shared statement and its balances wrong, so the root fix went into the core statement sort and the contracts input order.

## Watch out

- Anything that calls the core statement with records in arbitrary order now gets that order for same-day lines; go through the contracts statement helper or order the records first.
- Money text uses a non-breaking space between number and currency, so tests on Arabic statement text need `\s+`, not a plain space.
  In the code: packages/core/src/payables/index.ts (supplierStatement), packages/contracts/src/supplier-payments.ts (accountInput, previewSupplierPayment), apps/web/src/features/payables/, docs/adr/0015-supplier-workspace.md.
