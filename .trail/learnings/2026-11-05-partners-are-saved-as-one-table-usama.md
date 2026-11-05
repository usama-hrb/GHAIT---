---
title: 'Partners are saved as one table that must total 100%, reductions first, because the server checks one record at a time'
author: Usama
date: 2026-11-05
branch: refactor/product-inventory-v2
cost: { minutes: 1, tokens: 1904 }
id: l-485d1fab
scope: repo
status: active
src: agent
touches:
  - packages/contracts/src/partners.ts
  - apps/web/src/local-db/partners.ts
---

## Decided

- The server accepts each partner record when the ownership total stays at or under 100%, the owner flag is unchanged and there is one owner (`checkPartnerWrite`). It cannot demand exactly 100%: partners sync as separate records, and going from 50/50 to 40/40/20 record by record passes through totals that are not 100%.
- The Partners screen holds the owner's edit as a whole table, refuses to save unless it totals exactly 100% (`checkPartnerSet`), then writes the reductions before the increases (`partners.saveAll`) so the server never sees more than 100% between two writes. Drafts are full records: a partial draft overwrote the phone, title, start date and notes it left out.

## Tried and ruled out

- An exactly-100% rule on the server: it blocks every legitimate change of the shares.
- One batched "set the partners" endpoint: partners are ordinary synced records, saved on the device first, one sync op each.

## Watch out

- Order matters: an increase written before a reduction draws `partner_ownership_over_100` even though the final table is valid.

In the code: `packages/contracts/src/partners.ts` (`checkPartnerSet`, `checkPartnerWrite`), `apps/web/src/local-db/partners.ts` (`saveAll`), `apps/web/src/features/partners/ownership-dialog.tsx`, `docs/adr/0022-people-partners-and-salaries.md`.
