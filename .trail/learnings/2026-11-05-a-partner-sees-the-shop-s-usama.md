---
title: "A partner sees the shop's numbers and its own money, never another partner's money or contact details"
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 0 }
id: l-05d70bbb
scope: repo
status: active
src: agent
touches:
  - docs/accounting-assumptions.md
  - packages/contracts/src/access.ts
  - apps/api/src/modules/sync/sync.service.ts
  - apps/api/src/modules/partners/partners.controller.ts
---

## Decided

- SPEC §11 says a partner sees the same numbers as the owner; the account-management brief says a partner must never see another partner's private information. Both hold if the shop-level numbers, each partner's name, ownership percentage and the profit-split weights stay visible, while other partners' money records and contact data are cut. The sync pull sends a partner only its own `capital_move`, `partner_draw` and `settlement_share` rows and empties the other partners' `phone`, `notes` and exit fields. REST routes that return data across all partners or accounts became owner-only: audit, `GET /partners`, settlement preview and detail, a zakat report's detail, integrity, `/accounts`. A partner's own `partners/:id/account` stays; another partner's answers 403.
- The web screens a partner opens read the device's synced data, not those routes, so they keep working offline; the app hides the audit, integrity and accounts pages from a partner and shows an owner-only notice if the address is typed.

## Watch out

- Visible ownership percentages and split weights are a judgement the owner has not confirmed (assumption rows PS1 and PS2 in `docs/accounting-assumptions.md`). If the owner wants them hidden, change `recordForAccount` and the owner-only list together.
  In the code: `packages/contracts/src/access.ts` (`recordForAccount`), `apps/api/src/modules/sync/sync.service.ts`, `apps/api/src/modules/partners/partners.controller.ts`, `apps/api/test/accounts.e2e-spec.ts`.
