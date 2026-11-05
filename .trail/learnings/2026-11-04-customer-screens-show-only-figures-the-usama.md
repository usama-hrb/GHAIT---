---
title: Customer screens show only figures the core account already derives
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 35, tokens: 487296 }
id: l-6c965e73
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/customers/customer-view.ts
  - apps/web/src/features/customers/customer-view.test.ts
  - CLAUDE.md
  - packages/core/src/payments/account.ts
  - docs/accounting-assumptions.md
  - apps/web/src/features/customers/customers-screen.tsx
  - apps/web/src/features/customers/customer-screen.tsx
  - apps/web/src/features/customers/statement-text.ts
---

## Decided

- The core `customerAccount` now carries `purchasesCents`, `receivedCents` (payments less refunds), `refundedCents` and every non-voided invoice (`invoices`, with `returnedCents`). The customer screens only name, filter and join them. The web cannot show "total purchases / total payments" without adding money up itself, which CLAUDE.md forbids, and a hand-made sum would miss returns and refunds. Purchases less received equals the balance, pinned by a property test.
- The headline figure is "Outstanding" = `collectibleCents`. Credit held and written-off debt are notes under it, never a second "Owed"/"Balance" line: the two only ever differed by those.
- "Who owes" is the directory opened with the owing filter and oldest-first sort (`CustomersScreen debts`), not a second screen.
- Archiving a customer (the existing void) is owner only and only when nothing is collectible and no credit is held; a written-off debt does not block it.
- The write-off lives in the invoice's actions menu and only for the owner; the payment dialog still goes through `accounts.recordPayment` and its `previewPayment`.

## Tried and ruled out

- Totals computed in `customer-view.ts` from the sales and payments lists: duplicates accounting and double-counts refunds and returns.

## Watch out

- Amounts format with a no-break space between the number and the unit. An e2e `expect(text).toContain('500 ريال')` on the statement text needs ` `; `toContainText` on an element normalises it.
- After a write-off the bad-debt badge shows in the profile header and in the invoice row: scope e2e text lookups to the row.
  In the code: packages/core/src/payments/account.ts, apps/web/src/features/customers/customer-view.ts, customers-screen.tsx, customer-screen.tsx, docs/adr/0014-customer-workspace.md, docs/accounting-assumptions.md (CU1-CU6).
