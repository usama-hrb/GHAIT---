---
title: 'A shop that is missing migrations is found by asking its database, and migrators take a lock first'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 10, tokens: 168381 }
id: l-66df6873
scope: repo
status: active
src: agent
touches:
  - apps/api/src/database/migrate.ts
---

## Decided

- Whether a shop is "unavailable" is a fact read from the shop's own database, not a flag. The lookup asks whether the newest migration of this code is applied (the rule Drizzle itself uses: the newest `created_at` in `drizzle.__drizzle_migrations`) and answers 503 if not. A flag in memory would last until a restart. A state in the control database could be wrong after a restore. Asking the database also stops a shop that was never migrated, or left behind by `MIGRATE_ON_START=false`, and brings a fixed shop back within the 30 s lookup time with no restart.
- If the shop's database cannot be asked at all, the shop is served. A request to a database that is down fails on its own, and a fault in the check must not stop every shop. A database that is ahead of the code counts as current, so the code can go back one release.
- Every migrator takes a session advisory lock (`MIGRATION_LOCK`, "migr") on its own connection before Drizzle runs. Drizzle reads the applied list before it opens its transaction, so two migrators that start together both run the same migrations. The key is not the write lock of ADR 0002 ("fabr"), which every write takes. The lock is in `runMigrations`, so the one-shop server has it too.
- Start-up migrates the shops listed in the control database and no longer migrates the database in `DATABASE_URL` in multi-shop mode: that URL is the server and the login, not a shop.
- `SHOP=all` means every shop, so the slug `all` is reserved and `shop-new` must refuse it.

## Tried and ruled out

- A set of failed shops kept in memory by `main.ts` and handed to the app: it needs plumbing from `main.ts` into Nest and does not recover without a restart.

## Watch out

- A failed shop logs Drizzle's whole SQL statement in the error message. Log the cause's message instead (`reasonOf` in `shop-migrations.ts`).

In the code: `apps/api/src/database/migrate.ts`, `apps/api/src/database/shop-migrations.ts`, `apps/api/src/modules/shops/shop-schema.ts`, `apps/api/test/shop-migrations.e2e-spec.ts`.
