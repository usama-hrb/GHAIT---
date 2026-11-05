---
title: 'Page errors that only show in development are read from the dev web container log, not from a production walk'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 27, tokens: 148943 }
id: l-4bb5e21e
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/partners/remove-partner-dialog.tsx
  - apps/web/src/features/partners/partners-panel.tsx
---

## Decided

- When the owner reports errors on a page that a production-build walk shows clean, read the dev stack's web log first (`docker logs fabric-shop-dev-web-1`). The browser's development-only warnings are forwarded there as `[browser]` lines.
- Sibling dialogs that are always mounted get a key that differs when closed. They had all used the key `closed`, which made React report "two children with the same key" on every render of the People & partners page.

## Tried and ruled out

- Walking every settings page in the Playwright production build and watching console and page errors: React does not emit key warnings in production, so that walk reported nothing while the page was full of warnings.

## Watch out

- Dialogs that are mounted only while open (as `RemoveProductDialog` and `RemovePartnerDialog` are) cannot clash; the clash only happens with the always-mounted pattern `key={open ? 'x' : 'closed'}`.
- In the code: `apps/web/src/features/partners/partners-panel.tsx`, `partner-account.tsx`, `employees-panel.tsx`, `employee-detail.tsx`.
