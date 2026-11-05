---
title: "A month's expense list must show every bill the unpaid total counts"
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 28, tokens: 422603 }
id: l-39927944
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/expenses/expenses-screen.tsx
  - docs/adr/0016-expenses-workspace.md
  - packages/core/src/expenses/index.ts
  - apps/web/src/local-db/expenses.ts
  - apps/web/e2e/expenses.spec.ts
  - apps/web/src/features/expenses/expense-dialogs.tsx
  - apps/web/src/features/expenses/reminders.tsx
---

## Decided

- The expenses page lists the expenses that count in the month's figures (paid in the month, or unpaid and dated up to the month's end) plus those dated in the month. A bill carried over from an earlier month stays in the list, marked "from an earlier month"; one dated in the month but paid in another says which month it counts in. Why: the list used to be "dated in the month or paid in it" while the unpaid total also counted earlier months' unpaid bills, so a debt sat in the figure and nowhere in the rows.
- The total (paid + unpaid) and the entry count come from `monthlyExpenses`, and `expenseStanding` says how one expense counts in a month; the page only searches, filters by status and counts rows. Why: accounting maths stays in `@fabric/core` (E5).
- One bill a month per template is enforced in `createFromTemplate` (`recurring_expense_already_created`), not in the dialog, so a second tap or another device creates nothing (E7). `nextRecurringDue` (core) answers both the home reminders and the templates panel (E6).

## Tried and ruled out

- A free date-range filter: the spec's periods are months and a range needs totals it does not define, so the month navigator is the range (E8).
- A payment-method field in the expense dialog: the data has none and adding it would change the schema.

## Watch out

- When a month has no expenses, "New expense" is on the page twice (header and empty state): e2e specs click `.first()`.
- A radio's accessible name includes its hint text, which mentions "payment date": label lookups for the payment date field must be `exact: true`.
  In the code: `packages/core/src/expenses/index.ts`, `apps/web/src/local-db/expenses.ts`, `apps/web/src/features/expenses/`, `apps/web/e2e/expenses.spec.ts`, `docs/adr/0016-expenses-workspace.md`.
