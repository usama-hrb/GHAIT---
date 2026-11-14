---
title: The cross-shop route sweep is built from the OpenAPI document and stops on a route it cannot fill in
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 22, tokens: 401534 }
id: l-c39b4258
scope: repo
status: active
src: agent
touches:
  - docs/MULTI_SHOP_PLAN.md
  - apps/api/test/support/multi-shop-app.ts
  - apps/api/test/support/stock.ts
  - apps/api/test/zz-dump-docs.e2e-spec.ts
  - apps/api/test/cross-shop.e2e-spec.ts
  - apps/web/e2e/stack.ts
  - apps/web/e2e/global-setup.ts
  - apps/web/e2e/second-shop.spec.ts
  - '.github/workflows/ci.yml'
  - docs/MVP_ACCEPTANCE.md
---

## Decided

- The proof that one shop cannot read another through any route calls every GET route listed in the OpenAPI document at `/docs/json`, with path parameters taken from the records of the shop being asked. A new GET route is covered without editing the test. A route whose path parameter is not `id` or `key`, or whose required query parameter is not in `REQUIRED_QUERY`, makes the test throw instead of skipping the route, so a new kind of route cannot slip past the isolation check. When you add such a route, add its parameter in `apps/api/test/cross-shop.e2e-spec.ts` and write a record the route can return.
- A route that returns nothing in both shops proves nothing about isolation, so a positive-control list (19 routes that must show the shop's own data) keeps an empty answer from passing as an isolated one. A new route that lists shop data belongs in that list.
- The browser proof of a second shop stays in the adopted mode (`E2E_SHOPS=adopted`, `make e2e-shops`, its own CI step) and does not replace `make e2e`: the live server is a one-shop server until the owner turns the flag on, and the specs for that server must keep running as they are. Shop 1 is on `127.0.0.1`, the address every spec already uses, and the second shop is on `shop2.localhost`.

## Tried and ruled out

- Asserting in the browser spec that the shared shop already has records before the spec starts: it is empty when the spec runs alone, so the assertion failed. The comparison of the shared shop before and after holds either way; the shop with records is the API spec's job.
- Proving the `shop` claim check in the token guard with a test: the per-shop signing key already returns 401 before the claim is read, so removing the claim check fails nothing. It stays as a second lock; do not read a green suite as proof that it works.

## Watch out

- Breaking `ShopPools` so that it returns one pool for every shop is the mutation that the API spec catches (the second shop's owner cannot sign in); use it to check the proof still bites after changing the test support.
