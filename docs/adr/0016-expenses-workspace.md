# ADR 0016: The expenses workspace

Status: accepted (assumptions E5–E8).

## Context

The expenses page was a flat table with three buttons per row, a stats box that listed every
category and a second table for the monthly templates. Its list showed the expenses dated in the
month or paid in it, while the month's unpaid total also counted an earlier month's unpaid bills:
a bill could be in the figure and nowhere in the list. The templates said when they are due only by
a day number, and the same bill could be created twice from two devices.

## Decision

- **Every figure comes from `@fabric/core`.** `monthlyExpenses` also returns the total (paid +
  unpaid), the paid count and the entry count; `expenseStanding` says whether an expense counts as
  paid, as unpaid or not at all in a month; `nextRecurringDue` says which bill a template makes
  next and how soon it is (E5, E6). The repository (`local-db/expenses.ts`) joins them into
  `MonthView` (rows with their standing, whether they are carried over and the month they count
  in) and `TemplateView`; `features/expenses/expense-view.ts` only searches, filters by status and
  counts the rows. The page adds nothing up. No schema, API or contract changed.
- **The list reconciles with the figures.** An earlier month's unpaid bill stays in the list,
  marked; an expense dated in the month but paid in another says which month it counts in (E5).
- **One bill a month per template.** `createFromTemplate` refuses a second live expense for the
  same template and month; the dialog says so (E7). Creating is always a tap and a confirmed
  amount, never automatic, and nothing is paid by itself.
- **The page.** A header with the one gold action "New expense" (owner only), a month navigator
  (the period of every figure, E8), four figures (total, paid, unpaid, entries) with one line that
  says paid counts by payment date, search, All / Paid / Unpaid with counts and a category filter,
  then the history table with one actions menu per row (paid today, edit, void; a locked period
  shows the lock instead). The monthly templates sit in a panel beside the table from the `xl`
  width and below it otherwise, with a jump link at the top when one is due. Voiding and editing
  go through the existing audited repository paths.
- **The dialog** has two groups: the expense (category, amount, date, optional note) and the
  payment (paid or not yet, the payment date only when paid, and the month it will count in).
  There is no payment method: the data has none, and adding one would change the schema.

## Consequences

- Removed: the reminders panel from this page (the home screen keeps it), the per-category rows in
  the stats, the templates table, the per-row buttons and the old dialogs file.
- A reader of the page can check any figure against the rows under it.
- The page goes forward only to next month; reading further back is free.
