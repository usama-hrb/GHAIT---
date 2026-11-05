---
title: "A void dialog's confirm handler must catch its own errors, the dialog does not"
author: Usama
date: 2026-11-05
branch: refactor/product-inventory-v2
cost: { minutes: 1, tokens: 4899 }
id: l-7e26322c
scope: repo
status: active
replaces: l-c54f731f
src: agent
touches:
  - apps/web/src/shared/brand/void-dialog.tsx
---

## Decided

- Pass `VoidDialog` an `onConfirm` that catches the failure and shows it (the People screens map server answers to messages in `people-errors.ts`). The dialog runs `void onConfirm(reason).finally(...)` with no catch, so a rejection becomes an unhandled promise rejection: the dialog stops being busy and says nothing.

## Watch out

- The same holds for any dialog copied from it: an error thrown inside the submit handler is invisible to the person, who sees the button come back and nothing else.

In the code: `apps/web/src/shared/brand/void-dialog.tsx`, `apps/web/src/features/partners/people-errors.ts`, `apps/web/src/features/partners/employee-detail.tsx`.
