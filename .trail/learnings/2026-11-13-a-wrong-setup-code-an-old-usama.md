---
title: 'A wrong setup code, an old one and a closed sign-up all get the same answer, and ten wrong tries lock the code for good'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 20, tokens: 482851 }
id: l-929a8e93
scope: repo
status: active
src: agent
touches:
  - packages/contracts/src/setup-code.ts
  - apps/api/src/modules/registration/failed-tries.ts
  - apps/api/src/modules/registration/setup-codes.service.ts
  - apps/api/test/registration-setup-code.e2e-spec.ts
  - apps/api/src/modules/registration/failed-tries.spec.ts
---

## Decided

- One answer for everything that does not open a shop's sign-up (wrong, badly shaped, missing, old, used, stopped, another shop's code, no code waiting, OWNER_SIGNUP_ENABLED=false): the answer of a closed sign-up. A stranger then learns neither a code nor whether a shop waits for its owner. The only other answer is the 429 of the per-address limit, which says nothing about any code.
- Ten wrong tries on the waiting code stop it for good (revoked_at plus a shop.setup_code_locked event); the operator makes a new one. A cool-down was rejected: it only helps a guesser who waits. The count lives in the control database in its own transaction so it survives the rollback of the refused request and a restart. Five failed tries per client address in 15 minutes block the address (in memory, so a restart clears it); five is below ten on purpose, so one address cannot use up a code in one window.
- The API refuses to start with MULTI_SHOP=true and no SETUP_CODE_SECRET. Answering every sign-up as closed would hide the fault until an owner tried.
- The code is marked used inside the request, after the owner is written, with one conditional UPDATE (not used, not revoked, not expired). The unique owner index and the advisory write lock already serialise two racing sign-ups.

## Tried and ruled out

- Marking the code used after the request commits: a failure there leaves an owner and a code that still works, so one-use would depend on the order of two commits.
- A separate 4xx for a locked or expired code: it tells a stranger a shop is waiting.

## Watch out

- The mark is made before the shop transaction commits. If that commit then fails, the code is burnt and no owner exists; the fix is make shop-code.
- One address can still spend a code in two windows (5 + 5 tries). Accepted: no owner can be made without a code, and a shop that has an owner takes none.
- The web page must not leave the form on the closed answer of a code shop: it asks the status again and only a really closed shop ends the page, or the owner loses everything typed.

In the code: apps/api/src/modules/registration/setup-codes.service.ts, registration.service.ts, failed-tries.ts; packages/contracts/src/setup-code.ts; apps/web/e2e/signup-new-shop.spec.ts (runs with E2E_SHOPS=adopted only).
