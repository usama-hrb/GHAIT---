---
title: "Sales history figures come from the customer account, and 'collected' means applied to the sales shown"
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 17, tokens: 360856 }
id: l-a7902c5a
scope: repo
status: active
src: agent
touches:
  - packages/core/src/payments/sales-ledger.ts
  - packages/core/src/payments/sales-ledger.test.ts
  - packages/core/src/payments/index.ts
  - apps/web/src/features/pos/sales-history.ts
  - apps/web/src/features/pos/sales-history.test.ts
  - apps/web/src/features/pos/sales-results.tsx
  - apps/web/src/features/pos/sales-filter-bar.tsx
  - apps/web/src/features/pos/sales-metrics.tsx
  - apps/web/src/features/pos/sale-drawer.tsx
  - apps/web/src/features/pos/sales-list.tsx
---

## Decided

- The sales list takes each invoice's paid, due, written-off and overdue from the customer account (`customerAccountOf`, run once per customer, walk-ins as one more group), not from its own allocation sum. The list, the customer page and the debts list now share one meaning of "outstanding".
- The history strip adds up the rows shown with a core function (`salesLedger`), after classifying each with `paymentState`. "Collected" is what is applied to those invoices whenever it was paid, so total = collected + outstanding + written off. It is not the cash received in the period: summing payments by their own date counts money for other periods' sales and cannot be reconciled with the rows.
- The strip follows every active filter (period, search, payment) so it always agrees with the table. A voided sale is in no figure and is counted apart; a written-off debt is shown apart and left out of outstanding.
- A sale belongs to the shop day stored on it. Periods are plain date comparisons (`addDays`, `shopToday`); no timestamp is converted, so Casablanca's UTC+1/UTC+0 never moves a sale to another day.
- A sale has no number, only a uuid, so no reference is shown. A search of 6+ hex digits and dashes also matches the start of an id; a short word never does.

## Tried and ruled out

- Summing `payment` rows dated in the period for "collected": double counts across periods and refunds.
- A customer dropdown in the toolbar: the search box finds a customer faster and the dropdown crowded a tablet.
- Putting cost or profit in the drawer for the owner: the drawer is a quick look; the invoice page keeps profit for those who may see it.

## Watch out

- The e2e helper `openLastSale` clicks the first link in the table: it is now the receipt icon of the first row (the date is a button that opens the drawer), and it needs a viewport of 1024 px or more, where the table is shown.
- Filters live in component state only; coming back from an invoice shows the default last-30-days view.
  In the code: packages/core/src/payments/sales-ledger.ts, apps/web/src/local-db/sales.ts (`list`), apps/web/src/features/pos/sales-history.ts, sales-list.tsx, sale-drawer.tsx, docs/adr/0020-sales-history-workspace.md, docs/accounting-assumptions.md (SH1-SH6).
