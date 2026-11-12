---
title: The 404 page is a standalone client screen so it follows the device language and works signed out
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 5776 }
id: l-03ca13dd
scope: repo
status: active
src: agent
---

## Decided

- `app/not-found.tsx` is a thin server file (it only sets the title) that renders `NotFoundScreen`, a client component in `shared/brand`. The language is kept on the device, so a server-only page would always show English; `messages` follows the stored language once the client has started.
- It stands alone, with no sidebar and nothing read from the local database. A root-level not-found sits above the `(shop)` layout, and an unknown address may be opened signed out, so it looks the same signed in, signed out or offline. Its one gold action goes to `/home`, which sends a signed-out visitor to the sign-in page; the language and theme toggles stay, as on the sign-in page.
- The description is `text-foreground/80`, not `text-muted-foreground`: that token is 4.48:1 on the page background, a hair under AA, and the token file changes only with the owner's approval.
- `e2e/not-found.spec.ts` checks status 404, the language switch, the way home, and fit and contrast at 7 sizes in both languages, light and dark. `/this-page-does-not-exist` is also in the full responsive audit's route list.

## Tried and ruled out

- Precaching it in the service worker: the offline fallback (`/~offline`) is for failed navigations, and a 404 response is not one, so nothing needs caching.

## Watch out

- Every unmatched URL gets this page, including a mistyped path inside a known section such as `/inventory/no-such-page`.

In the code:

- apps/web/src/app/not-found.tsx
- apps/web/src/shared/brand/not-found-screen.tsx
- apps/web/e2e/not-found.spec.ts
