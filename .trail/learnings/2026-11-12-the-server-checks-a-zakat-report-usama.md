---
title: 'The server checks a zakat report for consistency but never recomputes it, because a report is a snapshot'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 8741 }
id: l-f59ff0c8
scope: repo
status: active
src: agent
touches:
  - apps/api/src/modules/zakat/zakat.service.ts
  - packages/contracts/src/zakat.ts
---

## Decided

- `ZakatService` validates a report it receives with `checkZakatReport`: the figures follow from the items by the core function, `hawlCompleted` is true, the hawl date is at most one day after the server's own day (absorbs a device in another time zone), and one live report per hawl (partial unique index `zakat_report_live_hawl_key`). It stores the report as sent.
- It does not rebuild the base from its own tables. A report is the shop's position at the moment a device saved it (assumption Z6): goods, money, receivables and debts as they were then. The current rows cannot be replayed to that moment, so a server-side recomputation would produce a different, wrong figure and look authoritative.

## Tried and ruled out

- Recomputing the base on the server to make it "the authority on the figures": rejected for the reason above. The trust boundary is the owner's device; only the owner can save a report (`@OwnerOnly`).
- A stored `status` or `paid_cents` on the report: it would be a second ledger that can disagree with the draws. Both are derived from live draws each time.

## Watch out

- A client that sends consistent but invented item values passes the check. That is accepted because the sender is the owner and the report is audit-logged, not because the server proved the values.
- Reports saved before supplier debts were deducted (SP4) show none in their breakdown. Show them as saved; never recalculate them.

In the code: `apps/api/src/modules/zakat/zakat.service.ts`, `packages/contracts/src/zakat.ts` (`checkZakatReport`, `ZAKAT_ISSUES`), ADR 0028 (alternatives rejected).
