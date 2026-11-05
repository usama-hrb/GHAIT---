---
title: "A void dialog's confirm handler must catch its own errors, the dialog does not"
author: Usama
date: 2026-11-05
branch: refactor/product-inventory-v2
id: l-c54f731f
scope: repo
status: active
src: agent
touches:
  - CLAUDE.md
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/app.module.ts
  - apps/api/src/database/index.ts
  - apps/api/src/database/schema/catalog.ts
  - apps/api/src/database/schema/expenses.ts
  - apps/api/src/database/schema/index.ts
  - apps/api/src/database/schema/partners.ts
  - apps/api/src/database/schema/photos.ts
  - apps/api/src/database/schema/sale-returns.ts
---

## Decided

- Pass `VoidDialog` an `onConfirm` that catches the failure and shows it (the People screens map server answers to messages in `people-errors.ts`). The dialog runs `void onConfirm(reason).finally(...)` with no catch, so a rejection becomes an unhandled promise rejection: the dialog stops being busy and says nothing.

## Watch out

- Same for any dialog you copy from it: a thrown error inside the submit handler is invisible to the person, who sees the button come back and nothing else.

In the code: `apps/web/src/shared/brand/void-dialog.tsx`, `apps/web/src/features/partners/people-errors.ts`, `apps/web/src/features/partners/employee-detail.tsx`.
