---
title: "Home dashboard shows gross profit per day from the profit report's own definitions, and leaves it out when costs are unreliable"
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 41, tokens: 668522 }
id: l-a997586a
scope: repo
status: active
src: agent
touches:
  - apps/web/src/local-db/db.ts
  - apps/web/src/local-db/home.ts
  - docs/adr/0018-home-dashboard.md
  - packages/contracts/src/reports.ts
  - apps/web/src/app/sw.ts
---

## Decided

- Home figures reuse the profit report's definitions per day (new `salesByDay` and `grossProfitByDay` next to `profitByMonth`), so the card, the chart and Reports cannot disagree; a unit test proves the days of a month add up to the report's month. The card says "gross" (sales less batch cost), never "profit", and is omitted when `periodBasisOf` refuses (a sale line without a reliable cost). A cashier's device never computes it.
- Supplier debts stay a figure, not an attention alert: purchases have no due date, so nothing can be "late".
- The activity feed has no table of its own. Each source reads its newest few through new Dexie v15 indexes (createdAt etc.). A customer payment made with a sale (same instant, device, customer) is skipped as it is already in the sale, and an unpaid expense is skipped because expenses count by payment date.
- Deep links from attention rows use URL params (`?filter=out`, `?status=unpaid`), so the service worker's precache match must ignore those params, or filtered links fail offline.

## Tried and ruled out

- Percent change on cards: undefined from a zero base and needs a rounding rule nobody decided; a plain integer difference shown only when the earlier total is above zero.
- Inline "create recurring bill" on Home: the expenses page already owns it; Home now links to `/expenses#recurring`.

## Watch out

- `Intl` in this machine's tzdata treats Casablanca as UTC+0 in November: tests must not assume an offset.
- User-typed names (Arabic product names in an English line) need `<bdi>`; otherwise the line reorders.
- Full API suite can fail with Postgres "too many clients" when run in parallel; rerun the failing files alone before suspecting code.

In the code: `packages/contracts/src/reports.ts`, `apps/web/src/local-db/home.ts`, `apps/web/src/features/home/`, `apps/web/src/app/sw.ts`, `docs/adr/0018-home-dashboard.md`.
