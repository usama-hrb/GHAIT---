---
title: 'Shops per API process are limited by PostgreSQL connections, not memory'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 35, tokens: 506892 }
id: l-fd5e328e
scope: repo
status: active
src: agent
touches:
  - docs/MULTI_SHOP_PLAN.md
  - apps/api/src/shop-scope.ts
  - apps/api/src/data-export.ts
  - apps/api/src/data-import.ts
  - apps/api/src/shop-scope.spec.ts
  - apps/api/test/shop-scope.e2e-spec.ts
  - infra/docker/backup/nightly.sh
  - Makefile
  - '.env.example'
  - infra/scripts/backup.sh
---

## Decided

- Plan for the number of shops by PostgreSQL connections, not by the memory of the API. Measured with the real API against PostgreSQL 16 (`max_connections` 100): the process is about 300 MB at start and each touched shop adds under 1 MB; each shop's pool opens up to `SHOP_POOL_MAX` (5) connections, so the peak is shops times the number of requests at once on each shop, up to 5.
- A real shop is one owner, a partner and a tablet or two: 2 or 3 requests at once. With 30 shops and 3 at once on each the peak was 90 connections and nothing failed; with 5 at once, 54 of 150 requests failed. Idle pools hold nothing (0 connections 12 to 15 seconds after the load, pg's 10 second idle timeout), so only shops in use take slots.
- Leave `SHOP_POOL_MAX` at 5 and `max_connections` at the default for now. Above about 30 shops, raise `max_connections` or lower `SHOP_POOL_MAX`; the API runbook already says to keep shops in use times `SHOP_POOL_MAX` plus 3 under it.

## Tried and ruled out

- Judging capacity by RSS or CPU: they stayed flat from 3 to 30 shops. The first thing to fail was the connection count.

## Watch out

- When Postgres runs out of connections the API answers HTTP 500 (log: `sorry, too many clients already`), not 503. Not fixed yet.
- These numbers are from a developer machine with 12 cores, not the owner's 2 vCPU server (Step 10 measures that). The nightly dump measured at the same time: 0.17 s for each database with an empty schema and about 50 MB of database for each second where there is data.

In the code: `apps/api/src/database/shop-pools.ts` (one pool for each shop, never evicted, `SHOP_POOL_MAX`), `docs/adr/0029-multi-shop-database-isolation.md` (Step 8 amendment, 6 and 7).
