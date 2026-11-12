---
title: 'Browser tests force a financial difference by tampering with the sync pull response, on every pull'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 1621 }
id: l-1e015e85
scope: repo
status: active
src: agent
---

## Decided

- The browser spec forces the Difference state by tampering with the sync pull response: a route handler on `/api/sync/pull` adds 1000 cents to the first `product_batch` record's `costTotalCents`, so stock at cost is held 10 dirham higher than the records explain (the page then shows 200 rial). No app code or stored figure is touched.

## Watch out

- The tamper has to be idempotent: the app pulls more than once per session, and a handler that alters only the first pull lets the second pull restore the real value (the page then showed Balanced). Remember the batch id and re-apply `original + 1000` on every pull that carries it.
- The route only sees the request when the context blocks the service worker (`serviceWorkers: 'block'`).
- Seed a part-paid supplier restock and a sale paid in full so the money line is negative: the worst-case layout (the negative-money note) is then on screen in every run.
- The Unable-to-verify state is forced by aborting the pull.

In the code: `apps/web/e2e/responsive.integrity.spec.ts`.
