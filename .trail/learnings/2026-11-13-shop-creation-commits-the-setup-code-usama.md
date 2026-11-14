---
title: 'Shop creation commits the setup code and the active state together, and never takes over a database it did not make'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 24, tokens: 592715 }
id: l-08302c1b
scope: repo
status: active
src: agent
touches:
  - apps/api/src/database/shop-names.ts
  - apps/api/src/database/control/operate.ts
  - apps/api/src/database/setup-code.ts
  - apps/api/src/database/shop-provisioning.ts
  - apps/api/src/database/shop-management.ts
  - apps/api/src/shop-commands.ts
  - apps/api/src/shop.ts
  - Makefile
  - infra/docker/compose.dev.yml
  - infra/docker/compose.prod.yml
---

## Decided

- `shop-new` is five idempotent steps (row `provisioning`, database, migrations, address, then setup code and state `active` in ONE transaction). The plan listed the code and the state as two steps; one transaction means a code is never shown for a shop that did not become active, and an active shop always has the code that was shown. Half-made shops have no address until the last transaction, so they answer 404, not 503.
- A second `shop-new` for a name that exists and is not `provisioning` is refused, not treated as a repeat. A database named `shop_<slug>` that exists with no shop row is refused too: the command must never adopt a database it did not make. In the code: `apps/api/src/database/shop-provisioning.ts`.
- Added two commands the plan did not list: `shop-close` (needs `REASON` and `CONFIRM=<slug>`; nothing dropped, addresses not released) because otherwise reaching `closed` means hand-written SQL, and `shop-host` because Step 4 left a second address to this step. No default address is made from a slug: the domain, DNS and TLS are the operator's (and Step 7's).
- Setup code: `hashSetupCode` signs a JSON list `["fabric-shop/setup-code", shopId, code]`. A string with `/` separators let `a/b`+`c` collide with `a`+`b/c`; a unit test caught it. A new code stops the waiting one with `shop_setup_code.revoked_at` (control migration 0002); expired codes are not counted as stopped. Step 6 must treat `revoked_at` as invalid.
- `SETUP_CODE_SECRET` (>= 32 chars) is optional at start in Step 5; only the commands that make a code require it. Step 6 decides whether the server refuses to start without it.

## Tried and ruled out

- Reading the "no database" case in `shop-list` from `error.code === '3D000'`: Drizzle wraps the driver error, so the code is on `error.cause`. The first run showed `unreachable` for a missing database. In the code: `errorCodeOf` in `shop-management.ts`.
- Making the half-way test with the real command alone: the obstacle table must exist before the migration, and the command refuses an unowned existing database, so the test writes the control row first (what a run that died after step 1 leaves) and then adds the obstacle. The row must carry the label the first run wrote, or the "same result as a clean run" comparison differs.

## Watch out

- The control table guard `control_keep_columns` makes `shop_setup_code.expires_at` immutable, so a test cannot expire a code with UPDATE: make it with an earlier `now` instead (`provisionShop(..., now)`).
- Refresh tokens rotate: a test that calls `/auth/refresh` twice with the same cookie gets 401, not 200. Keep the cookie from each response.
