---
title: 'Switching an account off must stop it on the next request, so the auth guard checks the database every time'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 0 }
id: l-5cba7e0d
scope: repo
status: active
src: agent
touches:
  - apps/api/src/modules/auth/auth.guard.ts
  - apps/web/src/local-db/session.ts
---

## Decided

- The global auth guard loads the account and its session on every request and answers 401 unless the session is not revoked, the account is neither voided nor deactivated, and the role in the token is still the account's role. Switching off also revokes every session so a refresh fails. Cost: one indexed read per request, which buys immediate revocation.
- Sign-in with a switched-off account answers 403 `account_deactivated` only after the right password, so a stranger cannot learn which usernames exist.

## Tried and ruled out

- Relying on the 15-minute access token expiring: a deactivated cashier would keep selling for up to 15 minutes.

## Watch out

- Tests that hand-sign a JWT now get 401: sign in for real so a session exists.
- By offline-first design a device already open stays on its local data after its account is switched off; at its next server contact the refresh fails and the device shows the "sign in again to sync" prompt (`needsSignIn`) instead of redirecting to the login page. Browser tests must assert that prompt, not a redirect.
  In the code: `apps/api/src/modules/auth/auth.guard.ts`, `apps/web/src/local-db/session.ts` (`refresh`), `apps/web/e2e/accounts.spec.ts`.
