---
title: API integration tests need a capped worker count or Postgres runs out of connections
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 0 }
id: l-5659e131
scope: repo
status: active
src: agent
touches:
  - apps/api/vitest.config.ts
  - apps/api/test/support/global-setup.ts
  - apps/api/test/support/app.ts
  - apps/api/src/database/client.ts
---

## Decided

- On a 12-core machine, `pnpm --filter @fabric/api test` (and so `make test`) fails in the `e2e` project with `error: sorry, too many clients already`, hitting a different set of 3 to 5 tests on each run (auth, database rules, purchasing sync pull, customers debts). Every failure is the Postgres server refusing a connection, not an assertion about shop behaviour.
- With `pnpm --filter @fabric/api exec vitest run --maxWorkers=4` the same suite is fully green: 32 files, 211 tests, no skips, about 22 s. That run covers the settlement, settlement-participants, partners, employees and expenses specs, so the accounting rules are verified; only the default parallelism is the problem.
- Cause: the e2e project shares one `postgres:16.15-alpine` container with its default `max_connections` of 100. Each test file builds a full Nest app whose pool is `max: 10` (`createPool`) plus a test pool of `max: 2`, and vitest runs as many files at once as there are cores. The suite grew from 21 to 27 spec files in the last commit, which moved it over the limit on this machine.

## Tried and ruled out

- Reading it as a regression in the new settlement or salary code: the failing tests are unrelated to them, move between runs, and vanish with fewer workers.

## Watch out

- Not fixed in the repo (verification task, no regression found). Options when someone picks it up: start the container with a larger `max_connections` in `global-setup.ts`, or set `maxWorkers` for the `e2e` project in `vitest.config.ts`, or lower the pool size under test. Not checked whether the previous commit already failed the same way on this machine.
- The web `tokens.contrast.test.ts` (11 failures) is the only other red unit test; it is the known baseline.

In the code: `apps/api/vitest.config.ts`, `apps/api/test/support/global-setup.ts`, `apps/api/test/support/app.ts` (`max: 2`), `apps/api/src/database/client.ts` (`max: 10`).
