---
title: 'A login account is not a partner or an employee, and each partner has one active login enforced by the database'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 45, tokens: 952352 }
id: l-293e2c2f
scope: repo
status: active
src: agent
touches:
  - packages/contracts/src/accounts.ts
  - packages/contracts/src/auth.ts
  - packages/contracts/src/audit.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/access.ts
  - apps/api/src/database/schema/auth.ts
  - apps/api/src/modules/accounts/accounts.service.ts
  - apps/api/test/accounts.e2e-spec.ts
  - docs/adr/0024-account-management.md
---

## Decided

- Cashier and partner logins live in `app_user` and are separate from the partner and employee records. Creating, switching off, switching on or resetting a login never creates or removes a partner, an employee, a balance, a capital contribution, a settlement or a sale. Reason: the owner asked that financial rights and login permissions stay separate, and a login must be switchable back on when a cashier returns, which a void (permanent, with reason) cannot do. Switching off therefore sets `deactivated_at`, not `voided_at`.
- A partner login links to exactly one existing partner through `app_user.partner_id`. "At most one active login per partner" is a partial unique index in the database, not only a check in code, because two concurrent requests can both pass a service-level check. The index plus the global write lock that every mutating request takes means five concurrent creations give exactly one 201 and four 409 `partner_has_account`.
- The role comes from the route (`POST /accounts/cashiers`, `POST /accounts/partners`), never from the body. The body schemas are strict, so a `role` or an unknown field is a 400 instead of being ignored. The owner role cannot be created through the API.
- A partner with an active login cannot be removed: a void guard on the partner entity refuses with `partner_has_active_login`, so no login points at a removed partner.

## Tried and ruled out

- Guessing which partner an old unlinked partner login belonged to: it would be a guess about who a login is. Migration 0034 switches those logins off, revokes their sessions and writes an audit entry for each; the owner makes a linked login again.
- One create route with a `role` field and a check on the server: leaves a privilege-escalation surface for no benefit.

## Watch out

- After the upgrade every partner login made earlier with `make partner-user` is off until recreated; `make partner-user` now needs `PARTNER=`.
- Accounts are never synced, so a device that removes a partner offline is accepted locally and rejected by the server on its next push; the owner switches the login off and removes the partner again.
  In the code: `apps/api/src/modules/accounts/accounts.service.ts`, `apps/api/drizzle/0034_account_management.sql` (index `app_user_one_active_partner_account`), `apps/api/src/modules/partners/partners.service.ts` (void guard), `packages/contracts/src/accounts.ts`, `docs/adr/0024-account-management.md`.
