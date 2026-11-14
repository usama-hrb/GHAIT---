---
title: 'A browser spec that adds a partner must void it, because every spec shares one database'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 40, tokens: 116803 }
id: l-503f146e
scope: repo
status: active
replaces: l-d37b5d74
src: agent
touches:
  - apps/web/e2e/accounts.spec.ts
  - apps/web/e2e/language.spec.ts
  - apps/web/src/shared/theme/theme-toggle.tsx
---

## Decided

- `accounts.spec.ts` now voids the partner it adds (`POST /partners/:id/void`) once the login is switched off. That was the whole cause of the red partner chain (`partners`, `partner-exit`, `settlements`, `zakat`, `zz-people`); the full browser run went from 98 pass and 12 fail to 109 pass and 0 fail (adopted: 112 and 0).
- `language.spec.ts` was stale, not the app: the header control is one "Switch to Arabic / English" button, and the sign-in password field has a "show password" button, so its label is matched with `exact: true`.

## Tried and ruled out

- Translating the language toggle's `aria-label`: `not-found.spec.ts` clicks "Switch to English" on an Arabic page, and a language switch that names its target language is the intended design. Only the theme toggle's labels moved to `messages.theme`.

## Watch out

- The 11 cases of `tokens.contrast.test.ts` are still red: they are brand tokens, changed only with the owner's approval. Values that pass are in `docs/MULTI_SHOP_PLAN.md`, "Audit after Step 10".

In the code: `apps/web/e2e/accounts.spec.ts`, `apps/web/e2e/language.spec.ts`, `apps/web/src/shared/theme/theme-toggle.tsx`.
