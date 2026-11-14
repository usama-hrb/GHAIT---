---
title: "Close the neighbours' addresses before turning the many-shop flag off, because a flag-off server answers every name with shop 1"
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 15, tokens: 397259 }
id: l-c9eed9f2
scope: repo
status: active
src: agent
touches:
  - docs/adr/0029-multi-shop-database-isolation.md
  - docs/runbooks/multi-shop-rollout.md
  - apps/web/src/local-db/session.ts
  - apps/api/src/modules/auth/token.service.ts
  - docs/runbooks/deploy.md
  - packages/contracts/src/registration.ts
---

## Decided

- Rolling back with neighbours starts at the proxy: empty `PLATFORM_DOMAIN` and `make up STACK=prod`, check that a neighbour's name fails with a TLS error, and only then set `MULTI_SHOP=false`. With the flag off the server does not read the address, so any name that still reaches it and already has a certificate opens shop 1's pages.
- A token made with the flag on is refused (401) when the flag goes off, and the other way round. It is signed with a key derived from the shop id, which the other mode does not use. Each device gets one 401, refreshes with its cookie and goes on; nobody types a password. Writing "ignored, nobody signed out" was wrong and was corrected in the ADR and the plan.
- Adopt the live shop in the running flag-off container first, read `make shop-list`, then one edit of `.env` and one `make up`. Adopting after the flag, or with the wrong address, makes the live address answer 404 "No shop is served at this address".
- Dumps made before the flag stay in `backups/` and are never rotated; the rollout runbook keeps the last one for a week and says to delete by hand. A script that deletes dumps was not added.

## Tried and ruled out

- Turning the flag off first and closing the edge after: the rehearsal showed a neighbour's address serving shop 1 in between.

## Watch out

- Only the owner can run the real Let's Encrypt, wildcard DNS and phone checks; the rehearsal used Caddy's own CA and the loopback, so those stages are written but not proven.

In the code: `docs/runbooks/multi-shop-rollout.md` (the stages and ways back), `docs/adr/0029-multi-shop-database-isolation.md` ("Step 10, the roll-out, was rehearsed", point 3), `apps/web/src/local-db/session.ts` (refresh once on 401), `apps/api/src/modules/auth/token.service.ts` (per-shop key).
