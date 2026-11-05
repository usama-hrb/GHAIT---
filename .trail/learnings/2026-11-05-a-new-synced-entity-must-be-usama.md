---
title: 'A new synced entity must be added to the export list, in foreign-key order, or backups and imports leave it out or fail'
author: Usama
date: 2026-11-05
branch: refactor/product-inventory-v2
cost: { minutes: 1, tokens: 5772 }
id: l-e59c74f5
scope: repo
status: active
src: agent
touches:
  - packages/contracts/src/data-export.ts
  - apps/api/src/modules/data/data.repository.ts
  - apps/api/src/modules/data/data.service.ts
---

## Decided

- `EXPORT_ENTITIES` is both the list of what an export holds and the order an import inserts it. A table that another table refers to comes first: `employee` and `employee_salary` sit before `expense` because `expense.employee_id` is a foreign key. The server's export, a device's export and `make import` all use this one list.

## Watch out

- Adding an entity to `SYNC_ENTITIES`, the Dexie schema and the sync registry is not enough. The export list is a separate edit, and the compiler only checks that each listed name is a sync entity, not that every sync entity is listed. A missing one is silently absent from backups and from a restored database.
- A wrong order fails at import with a foreign-key error, not at export, so it shows only when someone restores.

In the code: `packages/contracts/src/data-export.ts` (`EXPORT_ENTITIES`), `packages/contracts/src/data-export.test.ts` (the order check for employees), `apps/api/src/modules/data/data.repository.ts` (where each exported entity goes).
