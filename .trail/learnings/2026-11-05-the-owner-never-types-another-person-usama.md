---
title: "The owner never types another person's password: the server issues a temporary one, shown once, changed at first sign-in"
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 3431 }
id: l-ab45a611
scope: repo
status: active
src: agent
touches:
  - apps/api/src/modules/auth/auth.service.ts
---

## Decided

- Creating, reactivating or resetting an account makes the server generate a sixteen-character password (four dash-separated groups, alphabet without look-alike characters, `crypto.randomInt`), store only its argon2id hash, return it once, and keep it out of every log and audit entry. The account is flagged `must_change_password`; the guard answers 403 `password_change_required` on every route except `POST /auth/change-password` and `GET /auth/me` (`@MayCallWhileChangingPassword()`). Reason: an owner who chooses a worker's password knows it, and the audit trail then cannot say who acted.
- On the device the shop layout redirects such an account to `/change-password`, the sync loop pauses, and the device code is requested only after the change. The credential dialog cannot be dismissed by Escape or an outside tap, so the owner cannot lose the password by accident.

## Tried and ruled out

- Owner types the initial password in the form: rejected for the reason above. Email reset: the shop has no mail service.
  In the code: `apps/api/src/modules/accounts/temporary-password.ts`, `apps/api/src/modules/auth/auth.service.ts`, `apps/web/src/features/accounts/credential-dialog.tsx`, `apps/web/src/features/auth/change-password-screen.tsx`.
