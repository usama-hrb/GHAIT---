---
title: 'The sales history drawer carries the whole invoice and its actions, and rows get an actions menu'
author: Usama
date: 2026-11-11
branch: main
cost: { minutes: 48, tokens: 1060619 }
id: l-69b6fac4
scope: repo
status: active
replaces: l-a7902c5a
src: agent
touches:
  - '.env.example'
  - CLAUDE.md
  - Makefile
  - apps/api/drizzle/0033_owner_single.sql
  - apps/api/drizzle/0034_account_management.sql
  - apps/api/drizzle/meta/0033_snapshot.json
  - apps/api/drizzle/meta/0034_snapshot.json
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/app.module.ts
  - apps/api/src/common/index.ts
---

## Decided

- The sale drawer in the sales history shows everything the invoice page shows: batch of each line, minimum-price override, per-line profit, the sale's cost and profit, capital and recognized profit per payment, return reasons and goods, write-off reason. Cost and profit show to the owner and a partner and never to a cashier, the same rule as the invoice page.
- The actions (share, WhatsApp, record a payment, return goods, void) sit at the foot of the drawer. The last cell of each table row is an Actions menu with the same actions plus View details, instead of the old link to the invoice page. This replaces the earlier decision that the drawer is only a quick look without cost or profit.
- One function decides what a sale offers, so the invoice page, the drawer and the row menu cannot disagree. One component mounts the payment, return and void dialogs, and the history mounts it beside the list so a dialog opens over the drawer.
- The invoice page stays, because customers, home, the integrity report and stock movement history link to it and its `?id=` route must keep working offline. Only the history no longer links to it.

## Tried and ruled out

- Keeping the drawer as a quick look and sending the owner to the invoice page for payments and returns: the owner lost the filters on every round trip, because they are not kept.
- A second copy of the invoice page's lines table inside the drawer: that table needs more width than the 34 rem drawer has on a desktop, so the drawer lists the lines and adds the missing facts to each.
- Loading each row's sale to decide its menu: the list would read every sale's lines and payments. The menu reads the sale only when it opens.
- An actions menu inside the phone and tablet cards: a card is one button, and a menu inside a button is not valid. The whole card opens the drawer, whose foot carries the actions.

## Watch out

- Clicks inside a menu rendered in a portal still reach the row's click handler through React, so the trigger and the menu content stop propagation or every menu click also opens the drawer.
- A row now has two buttons that name the customer: the date button ("افتح بيع …") and the actions trigger ("إجراءات بيع …"). Tests that open the drawer must match the name from the start, `/^افتح بيع …/`, or Playwright reports two matches.
- `openLastSale` in the end-to-end helpers reads `data-sale-id` from the first row and opens the invoice page by address, because there is no link to click any more.
  In the code: `apps/web/src/features/pos/sale-actions.tsx` (`saleOptionsOf`, `SaleActionBar`, `SaleActionsMenu`, `SaleActionDialogs`), `sale-drawer.tsx`, `sales-results.tsx`, `use-sale.ts`, `apps/web/e2e/helpers.ts`, `docs/adr/0025-sale-drawer-carries-the-invoice.md`.
