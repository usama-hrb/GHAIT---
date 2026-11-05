---
title: 'Sign-up creates the first owner only, then closes, and the database guarantees one owner'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 60, tokens: 1082182 }
id: l-544563bb
scope: repo
status: active
src: agent
touches:
  - '.env.example'
  - Makefile
  - docs/runbooks/deploy.md
  - infra/docker/caddy/Caddyfile
  - docs/adr/0023-owner-self-registration-and-selling-units.md
  - docs/adr/0004-api-foundation.md
  - docs/runbooks/api.md
  - apps/web/e2e/auth-and-selling.spec.ts
  - apps/web/e2e/helpers.ts
  - apps/api/src/modules/auth/auth.service.ts
---

## Decided

- The owner chose "first-owner setup, then closed" over a sign-up that creates new shops. The product is one shop per server, and multi-shop isolation would need a shop id on every table and query, which is a different project. ADR 0023 replaces the ADR 0004 sentence that said there is no HTTP setup route.
- One live owner is enforced by a partial unique index, not by a check in the service. Two sign-ups racing each other cannot both succeed; the loser gets the closed answer. The check before the insert only gives a nicer message.
- The client never sends a role. The request schema has no role field and the server writes `owner` itself.
- Account, audit entry and the four shop settings commit in one transaction, so a failed settings write leaves no account behind.
- `OWNER_SIGNUP_ENABLED=false` closes the page even on an empty database, for a server whose owner is made with `make owner`. The deploy runbook says to open `/signup` yourself right after the first start, because the first visitor becomes the owner.

## Tried and ruled out

- A one-time setup token printed by the server: safer on an exposed server, but the owner asked for a plain sign-up page; the switch and the runbook cover the exposed case.
- Email verification and password recovery by email: both need a mail service the deployment does not have. The email is only the sign-in name; a forgotten owner password is still reset with `make owner`.

## Watch out

- The e2e global setup always creates an owner, so sign-up is closed in every Playwright run. The sign-up wizard itself is verified by API e2e and a browser run on a fresh database, not by the shared e2e suite.
- The sign-in helper in `apps/web/e2e/helpers.ts` must match the password label exactly: the show-password button's accessible name also contains those words.

In the code: `apps/api/src/modules/registration/`, `AuthService.registerOwner` in `apps/api/src/modules/auth/auth.service.ts`, migration `apps/api/drizzle/0033_owner_single.sql`, `docs/adr/0023-owner-self-registration-and-selling-units.md`.
