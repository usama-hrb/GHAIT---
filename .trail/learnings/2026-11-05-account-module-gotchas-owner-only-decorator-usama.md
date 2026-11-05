---
title: 'Account module gotchas: owner-only decorator lives in common, tests need real sessions, sync pull is capped at 500'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 2964 }
id: l-e3917e39
scope: repo
status: active
src: agent
touches:
  - apps/api/test/support/app.ts
---

## Watch out

- `@OwnerOnly()` is in `apps/api/src/common/owner-only.ts`, not in the auth module: the auth module imports the audit module and the audit controller needs the decorator, so keeping it in auth made an import cycle that Nest reported only as an undefined module import.
- supertest requests in one spec share a single server; an `address` of null means the server was closed too early. Tests of a deactivated account need a real login for the session row the guard now checks (a hand-signed JWT gets 401).
- `/sync/pull?limit` accepts 500 at most; a larger value is a 400, not a clamp.
- Run the browser spec for accounts alone with `cd apps/web && pnpm exec playwright test e2e/accounts.spec.ts --workers=1`; it starts its own Postgres container, API on 4310 and web build on 3310, so the dev stack on 4000/3000/5440 is untouched. Build the API first with `pnpm turbo run build --filter=@fabric/api`.
  In the code: `apps/api/src/common/owner-only.ts`, `apps/api/test/support/app.ts` (`addPartnerLogin`), `apps/web/e2e/accounts.spec.ts`.
