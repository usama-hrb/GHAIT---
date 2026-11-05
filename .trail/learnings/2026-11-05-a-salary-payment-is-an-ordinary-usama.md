---
title: A salary payment is an ordinary wages expense; the salary still owed is shown but never booked
author: Usama
date: 2026-11-05
branch: refactor/product-inventory-v2
cost: { minutes: 1, tokens: 2383 }
id: l-8b211f5c
scope: repo
status: active
src: agent
touches:
  - docs/accounting-assumptions.md
---

## Decided

- Paying a salary creates a normal expense in the `wages` category that carries `employeeId` and `salaryMonth` and a paid date. It is counted by its paid date like any expense (S6), so the period lock, audit, sync, cash figure and integrity check apply with no salary code of their own. Settlement reads the expense; there is no second calculation (PY1).
- What is owed (the month's rate minus the payments toward it) is derived and shown on the People pages only. Under the cash basis an unpaid salary is in no period, so it never changes a settlement. Voiding a payment makes the month owe it again.
- A database CHECK keeps the pair honest: `employee_id` and `salary_month` both or neither, and a salary payment must be `wages` with a paid date.

## Tried and ruled out

- A payroll table with its own payments: it needs its own period, lock, audit, sync and cash handling, and the settlement would read two sources of outgoing money.
- Booking the owed salary in the settlement: the settlement would then disagree with the Expenses page for one kind of expense.
- Salary as a partner draw: it hides a cost from the period's expenses and puts it in a partner's account.

## Watch out

- `salaryLedgerOf` once listed a month only because a raise starts in it, so a month-by-month view showed a future raise as an unpaid month. A month is listed only when it is the month asked for, earlier, or already paid. Unit tests written first missed it; the focused e2e found it.

In the code: `packages/core/src/payroll/index.ts` (`salaryLedgerOf`, `salaryMonthOf`), `packages/contracts/src/employees.ts`, `apps/api/drizzle/0031_people_and_salaries.sql`, `apps/api/src/modules/employees/`, rows PY1 to PY6 in `docs/accounting-assumptions.md`.
