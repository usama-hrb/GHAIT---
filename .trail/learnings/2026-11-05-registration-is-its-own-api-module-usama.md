---
title: 'Registration is its own API module, because auth importing settings makes a Nest import cycle'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 2910 }
id: l-a2dcba64
scope: repo
status: active
src: agent
touches:
  - apps/api/src/modules/auth/auth.module.ts
---

## Decided

- The sign-up route lives in `apps/api/src/modules/registration/`, and `AuthService.registerOwner(account, setUpShop)` takes the settings writes as a callback. The registration service passes it, so the auth module never imports the settings module.

## Tried and ruled out

- Importing the settings module into the auth module: settings imports sync, the sync controller imports the auth index, and the auth index imports the auth module. At start-up Nest then reports "The module at index [1] of the SettingsModule imports array is undefined", and which test file fails depends on import order, so it can look like a flaky test.

## Watch out

- If that message appears again, look for a new import from auth toward settings or sync before adding `forwardRef`.

In the code: `apps/api/src/modules/auth/auth.module.ts`, `apps/api/src/modules/registration/registration.service.ts`.
