---
title: "The people e2e spec is named to run last and compares the owner's and the cashier's sync pulls"
author: Usama
date: 2026-11-05
branch: refactor/product-inventory-v2
cost: { minutes: 1, tokens: 2818 }
id: l-9625aad0
scope: repo
status: active
src: agent
touches:
  - apps/web/tsconfig.json
  - apps/web/e2e/global-setup.ts
---

## Decided

- `zz-people.spec.ts` sorts last on purpose: every e2e spec shares one database and runs on one worker, and this one leaves a third partner, employees and wage expenses behind. It must not run before specs that assume a shop with one partner.
- Its cashier check logs in as both roles, pages `/sync/pull`, and asserts that the owner's pull holds `employee`, `employee_salary` and `partner` records while the cashier's holds none of them.

## Tried and ruled out

- Asserting only that the cashier's pull has no employee records: on a fresh shop there are none for anyone, so it passed without testing the access rule. Comparing the two roles' pulls cannot pass that way.

## Watch out

- `apps/web/tsconfig.json` includes every `.ts` file, e2e specs and Playwright configs among them, and the e2e `globalSetup` builds the web app each run. A type error in a spec fails `next build`, so the whole run stops before any test starts.

In the code: `apps/web/e2e/zz-people.spec.ts` (`pulledEntities`), `apps/web/e2e/global-setup.ts`, `apps/web/tsconfig.json`.
