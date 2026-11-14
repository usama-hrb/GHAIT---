---
title: 'Serve many shops from one server with a database for each shop, found by the address of the request'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 7072 }
id: l-76cee89e
scope: repo
status: active
src: agent
touches:
  - apps/api/src/database/transaction.ts
  - apps/api/src/database/client.ts
  - apps/api/src/common/http.ts
  - infra/docker/backup/nightly.sh
---

## Decided

- Recommended in ADR 0029 (proposed; the owner has not approved it yet): each shop gets its own Postgres database, and the live one becomes shop 1 untouched. A small control database lists shops, addresses, setup codes and state. The shop is found from the request's host name, because a browser keeps the local database, the service worker cache and the cookie for each origin. A path, header or port would mix two shops on one tablet.
- Chosen over a shop id on every table because the write lock and `server_seq` belong to a database. So the commit order of ADR 0002 holds for each shop with no change, and the earlier "different project" objection (sign-up learning of 2026-11-05) does not apply.
- The `MULTI_SHOP=false` path is the compatibility guarantee, and the proof is the whole existing test suite passing with the flag off and no test changed. The token gets a `shop` claim that old code ignores (zod drops unknown keys), so turning the flag off never signs anybody out.
- The first owner of a new shop needs a setup code in multi-shop mode, because a new host name is public within minutes through certificate logs. This reverses the 2026-11-05 "no setup token" choice for that mode only.

## Tried and ruled out

- The plan's "ask route is safe outside /api": Caddy strips `/api`, so any API root route is public as `/api/...`. Block `/api/internal/*` in Caddy and refuse requests that carry `X-Forwarded-For`.
- Finding the shop in `RequestContextMiddleware`: it lives in `common`, which must never import modules. Use a step from a `shops` module, registered in `app.module.ts`.
- "No cache for the control database": it would stop every shop whenever it blinks.
- A `/health` that reports a failed shop: Docker calls it as `127.0.0.1` and fails on a 404, so it stays public liveness outside the host rule.

## Watch out

- `createPool` has no connect timeout and nobody listens for the pool's `error` event. With one pool for each shop, one database problem can stop every shop.
- The nightly prune pattern `/backups/<db>_*.dump` also matches `<db>_two`. Use a directory for each shop.
- A device's local database has no shop identity. Never point an address at a different shop: the device would pull and push another shop's data.
- Each API test file opens 12 connections against `max_connections` 100. More pools for each app make that worse.

In the code: `docs/adr/0029-multi-shop-database-isolation.md`, `docs/MULTI_SHOP_PLAN.md`, `apps/api/src/database/transaction.ts`, `apps/api/src/database/client.ts`, `apps/api/src/common/http.ts`, `infra/docker/caddy/Caddyfile`, `infra/docker/backup/nightly.sh`.
