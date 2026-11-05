---
title: E2E polls that reload a page must wait for it to render before counting
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 1, tokens: 1529 }
id: l-266228a0
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/roles.spec.ts
---

## Decided

- In an `expect.poll` that does `page.goto(...)` and returns a `locator.count()`, wait for the locator first (`waitFor` with a short timeout, errors swallowed), then count. `goto` resolves at `load`; hydration and the local Dexie read render the tiles after it, so an immediate `count()` is 0 on a busy run, on every retry.

## Tried and ruled out

- Blaming new Dexie indexes for the cashier specs failing in a full run: emptying the new stores changed nothing.
- Blaming a newly added spec's data: the failure reproduced without it, and only when a spec that creates many customers ran first (more local data, slower render).

## Watch out

- The cashier till specs pass alone but time out with "received 0" inside a long run, because a poll like this one races the render.
  In the code: apps/web/e2e/min-price.spec.ts and apps/web/e2e/roles.spec.ts, the polls on the cashier's page.
