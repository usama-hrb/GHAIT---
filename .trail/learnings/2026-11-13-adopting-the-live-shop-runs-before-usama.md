---
title: 'Adopting the live shop runs before the multi-shop flag, and the whole suite is re-run as an adopted shop'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 22, tokens: 338462 }
id: l-e2018400
scope: repo
status: active
src: agent
touches:
  - apps/api/src/database/shop-adoption.ts
  - apps/api/src/shop-adopt-command.ts
  - apps/api/src/shop-adopt.ts
  - apps/api/src/database/index.ts
  - Makefile
  - apps/api/test/shop-adopt.e2e-spec.ts
  - apps/api/test/control-database.e2e-spec.ts
  - apps/api/vitest.adopted.config.ts
  - docs/runbooks/api.md
---

## Decided

- `make shop-adopt` works while `MULTI_SHOP=false`, because the rollout adopts first and flips the flag after. The command builds its own config with the flag forced on (`loadConfig({ MULTI_SHOP: 'true' })`), so the live server keeps running untouched.
- The shop's database is the one in `DATABASE_URL`. It is read through a session that the server holds read-only (`default_transaction_read_only=on`), so a stray write would fail instead of changing a live shop. A database with no migrations table is refused before anything is made: a wrong `DATABASE_URL` must not create a control database or give an address to an empty shop.
- Adopting writes `shop`, `shop_host` and `shop_event` in one control transaction under an advisory lock. The same shop and address again writes nothing. A new address for an adopted shop is refused: adding addresses is Step 5, and adopting must not quietly change a shop.
- The proof "the whole existing suite passes with a shop adopted" is `createTestApp` switching mode with `TEST_SHOPS=adopted` (`pnpm test:e2e:adopted`). It adopts the test database as `shop_one` at `127.0.0.1`, the host supertest uses. Calls the specs make through `app.get(Service)` are bound to that shop one call at a time, because a service has no shop outside a request in multi-shop mode.
- Seven tests are skipped in that run and the spec files are untouched: two are the one-shop describe, four pin `toEqual({ open })` on a status that now carries `shopId`, and one counts an attempt made by the test before it. Their multi-shop shape is tested in `test/shop-adopt.e2e-spec.ts`.

## Tried and ruled out

- Excluding single tests with a negative-lookahead `-t` or `testNamePattern`: vitest runs every test inside a describe whose own name matches, so only whole describes are excluded. A `beforeEach` in `test/support/one-shop-only.ts` skips by `task.fullTestName` (joined by `>`).
- Editing the four assertions to `toMatchObject`: the owner said the specs must not change.

## Watch out

- Control migrations had no lock (Step 1): two `prepareControlDatabase` runs together crashed on `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations`. `withMigrationLock` now serves both the shops and the control database. It was seen only because adopting can run while the API starts.
- A new spec that asserts the exact JSON of a response will fail in adopted mode if the response gains a `shopId`. Use `toMatchObject` or add it to `one-shop-only.ts` with the reason.
