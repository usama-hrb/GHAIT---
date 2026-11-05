# ADR 0018: The Home dashboard

Status: accepted. No stored figure and no accounting rule changed; the per-day readings of existing
definitions are rows HM1–HM6 in `accounting-assumptions.md`.

## Context

Home was a narrow column (`max-w-4xl`) of loose cards: today's sales, three shortcuts, a list of
low-stock products, a list of overdue customers, a list of suppliers owed, and two reminders
(recurring bills, zakat). It answered "what is today's total" but not "how is the shop doing", it
repeated debts in three places, and it read whole tables (`sales.list()`, `accounts.debts()`) to
show a few lines.

## Decision

### Three questions, five parts

Home answers: how is the shop performing, what needs me today, what can I do now. In reading order
on a phone, and in a container-query grid on a wide screen (`@container`, so the layout follows the
room the content has, not the window; the sidebar is taken into account):

1. **Header**: greeting (by the shop's hour, `useGreeting`), the date, the three actions. Sell is
   the screen's one gold action; New purchase and New expense are not shown to a cashier.
2. **Four figures**, each a link to the page where it is worked on: today's sales (`/pos/history`),
   today's **gross** profit (`/reports`), owed by customers (`/customers/debts`), owed to suppliers
   (`/payables`). The last two and the profit are not for a cashier.
3. **Sales chart**: daily sales for the last 7 or 30 days (Recharts through `shared/ui/chart`, one
   series, as the Reports charts), with the period total and its difference from the previous
   period of the same length, a table for screen readers, an empty state that links to Reports.
4. **Needs attention**: only what has something to do, ranked and grouped _urgent_ / _soon_
   (`attention.ts`): out of stock, customers late paying, recurring bills late, changes refused by
   the server; then low stock, unpaid expenses, recurring bills due, zakat, products awaiting a
   length. Nothing to do is one calm line, not a grid of empty cards. Each row opens the page that
   fixes it, already filtered where the page can be (`/inventory?filter=out|low|awaiting`,
   `/expenses?status=unpaid`, `/expenses#recurring`).
5. **Recent activity**: the newest ten events, one compact list, each with a link to its record.

Wide: the sales chart and the attention list form the main column and the activity a column of
20–26 rem beside it (so the feed is never stretched); medium and small: one column, attention
before the chart.

### Where the numbers come from

- `HomeRepository` (`local-db/home.ts`) is the only reader; the screens never touch Dexie. Each
  method is one small live query and each section runs its own, so a sale re-reads the sales and
  not the stock. A section that cannot be read says so in its place (`SectionBoundary`) and leaves
  the others as they are.
- **No accounting is added up in the UI or the repository.** Sales by day and gross profit by day
  are two new pure functions in `@fabric/contracts` (`salesByDay`, `grossProfitByDay`, next to
  `profitByMonth`, which they split: the days of a month add up to the report's month, tested).
  Debts are the customer and supplier accounts (the same figures as their screens); the unpaid
  expenses are `monthlyExpenses` of `@fabric/core`; stock status is the product ledger's.
- **Profit is gross and is optional.** It is sales less the batch cost of what was sold (FIFO as
  the batches record it), not the settlement's net. When a sale line of the period has no reliable
  cost, `periodBasisOf` refuses and the card is left out rather than guessed. A cashier's device
  never computes it (SPEC §11).
- **Comparison** is a difference of two integer totals shown only when the earlier total is above
  zero; there is no percentage, so nothing is rounded.
- **Supplier debts are a figure, not an issue**: a purchase has no due date, so nothing is "late".
  Alerting on any balance would be a daily nag with nothing to do.
- **The activity feed has no table.** Each kind reads its newest few by when they were made (new
  Dexie indexes, below) and the lists are merged and cut. Two rules keep it honest (HM6): a
  customer payment made with a sale at the till is the sale's own (same instant, device and
  customer) and is not listed again, and an unpaid expense is not money out, so it is an attention
  item and not an event.
- "Today" is `useShopToday` (a clock that ticks), so a till left open overnight moves to the new
  day; a live query alone only re-runs when data changes.

### Storage and sync

- Dexie **version 15 adds indexes only** (`createdAt` on sales, payments, purchases, supplier
  payments and expenses; `[type+createdAt]` on stock moves; `date` on returns). No record is
  rewritten, nothing is synced differently, nothing on the server changed.
- The deep links use URL parameters (`filter`, `status`). The service worker already ignores
  parameters it does not know when matching the precache, so it learned these two (`app/sw.ts`);
  offline a filtered link would otherwise miss the precached page. The inventory and expenses pages
  read the parameter only for the initial filter and are wrapped in `Suspense`, as `useSearchParams`
  requires.
- Home waits, with a notice, until the device has pulled once (`maintenance.pulledOnce`): zeros
  from an empty device would look like facts. The actions stay available meanwhile.
- Freshness: a line at the bottom says the figures are this device's and when it last synced.
  Changes still waiting to be sent are already in every figure (they are in the local records); the
  header shows how many are waiting.

### Removed

- The home's own lists of low products, overdue customers and suppliers owed, and the inline
  recurring-bill reminder with its "create" dialog: the stock and customer screens already show
  those lists, and the bill is created from the template on the expenses page, where "Bills due"
  now links (`/expenses#recurring`). Components deleted: `ExpenseReminders`, `PayablesSummary`,
  `ZakatReminder` (zakat is now an attention row built from the same `zakat.reminder()`).
  `sales.returnedOn` (the old Home's return correction) is no longer called by the UI; it stays
  with its test in the repository.

## Consequences

- One definition of "sales of a day" for the chart, the card and Reports; the consistency is a
  unit test, not a convention.
- The Home costs a handful of indexed range reads instead of three full-table reads.
- The creation of a recurring expense is one tap further from Home (it opens the template on the
  expenses page).
- A new alert type is a row in `attention.ts` (its rank and its link) and two strings.

## Tried and ruled out

- A percentage change on the cards: undefined from a zero base, and it would need a rounding rule
  nobody has decided.
- An "activity" table written beside every sale, payment and expense: a second record of each event
  to keep in step, for a list the records already hold.
- Counting "batches to review" among the sync issues: it needs the whole move history; the outbox's
  refused changes are enough for the Home and the batches have their own screen.
- Revenue under the word "profit" when a cost is missing: the point of the card is that it can be
  trusted.
