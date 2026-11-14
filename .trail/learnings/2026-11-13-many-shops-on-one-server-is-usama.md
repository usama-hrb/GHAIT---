---
title: 'Many shops on one server is accepted: the control database comes from the same server, and only multi-shop pools get a connect timeout'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 1, tokens: 5524 }
id: l-d160c3b5
scope: repo
status: active
replaces: l-3c2299ab
src: agent
touches:
  - apps/api/src/database/client.ts
  - apps/api/package.json
---

## Decided

- The owner accepted ADR 0029 on 2026-11-12 ("do step 1"): a database for each shop, the live shop becomes shop 1 untouched, plus a small control database for shops, addresses, setup codes and events. The shop is chosen by the host name of the request, because a browser keeps the local database, the service worker cache and the cookie for each origin. The owner asks for each later step by name, and each step ends with a report and a stop.
- Chosen over a shop id on every table: the write lock and `server_seq` belong to a database, so the commit order of ADR 0002 holds for each shop unchanged. To prove that `MULTI_SHOP=false` leaves the one-shop server as it was, run the whole existing test suite with the flag off and change none of its tests.
- Name the control database with `CONTROL_DATABASE_NAME` and take its URL from `DATABASE_URL` by changing only the database name. There is no `CONTROL_DATABASE_URL`: it is always the same server and the same login, so a second URL could only disagree with the first.
- Every pool gets an `error` listener, but only pools made in multi-shop mode get a connect timeout (10 seconds). pg-pool 3.14.0 also uses `connectionTimeoutMillis` for the wait for a free connection when the pool is full, and a mutating request holds its connection while it waits for the advisory write lock. A timeout on the one pool of the one-shop server would turn a short queue behind a burst of writes into "timeout exceeded when trying to connect".
- Control tables follow the data rules with their own guards (`install_control_guards`), because they have no `server_seq` or `device_id`. A test fails for a control table without the delete guards.
- A new shop's first owner needs a setup code (this reverses the 2026-11-05 choice for multi-shop mode only), because a new host name is public within minutes through the certificate logs.

## Tried and ruled out

- Handling only "database already exists" (42P04) when two processes start together. With four callers at once, the loser gets a unique violation on `pg_database_datname_index` (23505) instead. `ensureDatabase` accepts both.
- A connect timeout on every pool, as the first text of ADR 0029 said. The amendment of 2026-11-13 explains why not.
- An `ask` route outside `/api`: Caddy strips `/api`, so it is public as `/api/...`. Block `/api/internal/*` in Caddy and refuse requests that carry `X-Forwarded-For` (Step 7).
- Finding the shop in `RequestContextMiddleware`: `common` must never import modules. The host step goes in `modules/shops`, and `app.module.ts` registers it.
- No cache on the control lookup, and a `/health` that reports a failed shop: the lookup needs a short cache that serves stale answers, and Docker calls `/health` as `127.0.0.1` and fails on a 404.

## Watch out

- `pnpm deploy --legacy` copies only the paths in `files` of `apps/api/package.json`. Without `drizzle-control` there, the production image has no control migrations.
- In multi-shop mode the database login must be allowed to create databases. Without it, start-up fails with "permission denied to create database".
- The nightly prune pattern `/backups/<db>_*.dump` also matches `<db>_two` (Step 8). A device's local database has no shop identity, so never point an address at another shop.

In the code: `apps/api/src/database/client.ts`, `apps/api/src/database/create-database.ts`, `apps/api/src/database/control/migrate.ts`, `apps/api/drizzle-control/0001_control_guards.sql`, `apps/api/package.json`, `docs/adr/0029-multi-shop-database-isolation.md`.
