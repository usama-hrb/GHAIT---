---
title: 'Stock math belongs only in the shared core package, never in screens or the local database layer'
author: Usama
date: 2026-11-04
standing: true
id: l-917b26da
scope: repo
status: active
src: init-sessions
touches:
  - packages/core/src/products/stock.ts
---

## Decided

- Team kept all ledger and cost arithmetic in one tested place. Contracts only map into it, and the UI reads view models.
- In the code: Add stock calculations in packages/core/src/products/stock.ts. contracts bridge calls core and adds no new math. apps/web local-db builds view models (statuses, summary, filters, detail) from core. React components do no stock arithmetic.

_From past Claude sessions here, Nov 3._
