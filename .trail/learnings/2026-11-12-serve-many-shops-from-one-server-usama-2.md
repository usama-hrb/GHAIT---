---
title: 'Serve many shops from one server with a database for each shop, found by the address of the request'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 4514 }
id: l-3c2299ab
scope: repo
status: active
replaces: l-76cee89e
src: agent
touches:
  - apps/api/src/database/client.ts
  - apps/api/src/database/transaction.ts
  - apps/api/src/common/http.ts
  - infra/docker/backup/nightly.sh
---

## Decided

- ADR 0029 (proposed, not yet approved by the owner): a database for each shop, the live one becomes shop 1 untouched, plus a small control database for shops, addresses, setup codes and state. The shop comes from the request's host name, because a browser keeps the local database, the service worker cache and the cookie for each origin. A path, header or port would mix two shops on one tablet.
- Chosen over a shop id on every table: the write lock and `server_seq` belong to a database, so the commit order of ADR 0002 holds for each shop unchanged.
- The compatibility proof for `MULTI_SHOP=false` is the whole existing test suite passing with the flag off. The new `shop` claim in the token is ignored by old code (zod drops unknown keys), so turning the flag off signs nobody out.
- A new shop's first owner needs a setup code, because a new host name is public within minutes through certificate logs. This reverses the 2026-11-05 "no setup token" choice for multi-shop mode only.

## Tried and ruled out

- "The ask route is safe outside /api": Caddy strips `/api`, so it is public as `/api/...`. Block `/api/internal/*` and refuse requests that carry `X-Forwarded-For`.
- Finding the shop in `RequestContextMiddleware`: `common` must never import modules.
- No cache on the control database: it would stop every shop whenever it blinks.
- A `/health` that reports a failed shop: Docker calls it as `127.0.0.1` and fails on a 404.

## Watch out

- `createPool` has no connect timeout and nobody listens for the pool's `error` event. With a pool for each shop, one database problem can stop every shop.
- The nightly prune pattern `/backups/<db>_*.dump` also matches `<db>_two`.
- A device's local database has no shop identity. Never point an address at another shop.

In the code: `docs/adr/0029-multi-shop-database-isolation.md`, `apps/api/src/database/client.ts`, `apps/api/src/database/transaction.ts`, `apps/api/src/common/http.ts`, `infra/docker/backup/nightly.sh`.
