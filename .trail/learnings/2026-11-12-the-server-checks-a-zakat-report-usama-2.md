---
title: 'The server checks a zakat report for consistency but never recomputes it, because a report is a snapshot'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 4785 }
id: l-f7c41ac8
scope: repo
status: active
replaces: l-f59ff0c8
src: agent
touches:
  - apps/api/src/modules/zakat/zakat.service.ts
  - packages/contracts/src/zakat.ts
---

## Decided

- `ZakatService` validates a report it receives with `checkZakatReport`: the figures follow from the items by the core function, `hawlCompleted` is true, the hawl date is at most one day after the server's own day (absorbs a device in another time zone), and there is one live report per hawl (partial unique index `zakat_report_live_hawl_key`). It stores the report as sent.
- It does not rebuild the base from its own tables. A report is the shop's position at the moment a device saved it (assumption Z6). The current rows cannot be replayed to that moment, so a server recomputation would give a different figure that looks authoritative.

## Tried and ruled out

- Recomputing the base on the server to be "the authority on the figures": rejected for the reason above.
- A stored `status` or `paid_cents` on the report: a second ledger that can disagree with the draws. Both are derived from the live draws each time.

## Watch out

- A report with consistent but invented item values passes the check. That is accepted because only the owner's account can push one (a partner's write is refused by the sync hub, a cashier has no access to the entity in `CASHIER_ACCESS`) and every save is audit-logged. The server has not proved the values.
- Reports saved before supplier debts were deducted (SP4) show none in their breakdown. Show them as saved; never recalculate them.

In the code: `apps/api/src/modules/zakat/zakat.service.ts`, `packages/contracts/src/zakat.ts` (`checkZakatReport`, `ZAKAT_ISSUES`), `packages/contracts/src/access.ts` (`mayPush`), ADR 0028.
