# ADR 0020: The sales history as a workspace

Status: accepted. No stored figure, contract, schema, sync handler or server check changed. The
rules this records are rows SH1–SH6 in `accounting-assumptions.md`. Decision 2 (the drawer is a quick
look, and the invoice page does the rest) was replaced by [ADR 0025](0025-sale-drawer-carries-the-invoice.md):
the drawer now carries the whole invoice and its actions.

## Context

`/pos/history` was a centered four-column table (date, customer, lines, remaining) with no search,
period, payment filter, totals, paging or way to look at a sale without leaving the list. The owner
could not answer "how much did we sell this month, how much of it is collected, who still owes" from
it, and the page did not use the width of a desktop or a tablet.

## Decision

1. **One page, full width, in three bands.** A header (title, description, the period, the New sale
   action to `/pos`), the figures and filters, and the results. The table has eight columns (date,
   customer, items, total, paid, remaining, status, and a receipt link to the invoice page); below
   1024 px the sales are cards, so a tablet held upright and a phone never scroll sideways. Rows are
   cut into pages of 25 on the device (`pageOf`).
2. **A details drawer, not a page.** Clicking a row opens the sale in a right-hand drawer (a
   full-screen sheet below 1024 px): date, customer and phone, items with quantity and price, the
   discount, total, returns, paid, remaining, the payments applied to it, the note and the void
   reason, and two actions that already existed: open the invoice page and share it. Paying,
   returning goods and voiding stay on the invoice page `/pos/view?id=` (the record page keeps its
   `?id=` route, so the service worker and offline keep working). The drawer shows no cost and no
   profit to any role; the invoice page keeps showing them to those who may see them.
3. **Every figure comes from the customer account.** `SalesRepository.list()` now takes each
   invoice's worth, paid, due, written-off and overdue from `customerAccountOf`, the function the
   customer screens call, run once per customer (walk-in sales are one more group). It no longer
   works out the due itself. The classification (`paymentState`) and the sum over the sales shown
   (`salesLedger`) are `@fabric/core` functions, with tests, and the invariant
   `total = paid + outstanding + written off` is a property test.
4. **Metrics follow what is shown.** The four figures (sales, total, collected, outstanding) are the
   `salesLedger` of the rows that pass the period, the search and the payment filter, so the strip
   and the table always agree. A reader who wants "this month" picks the period; one who wants "what
   fatima owes" searches her name.
5. **The period is shop days, compared as dates.** A sale belongs to the shop day stored on it
   (`sale.date`); presets (today, last 7 or 30 days, this month, all, custom) are computed from the
   shop's today (`shopToday`) by plain date arithmetic (`addDays`). No time zone is involved in a
   comparison, so the Casablanca offset (UTC+1, UTC+0 in Ramadan) cannot move a sale to another day.
   The default is the last 30 days, so a month start does not open on an empty list.
6. **Search** matches the customer's name and the sale's note, with the same normalization as the
   other search boxes (Arabic letter variants, diacritics, digits). A sale has no number, only a
   uuid: no reference is invented. A search of six or more hex digits and dashes is also read as the
   start of a sale id, so an id copied from a link finds its sale; a short word never matches an id.
7. **No customer dropdown.** The search box finds a customer by name faster than a list of every
   customer would, and a dropdown beside it crowded the toolbar on a tablet.

## Alternatives rejected

- A modal inside the POS: the history is a management screen, and the till's screen stays free.
- Summing `payment` rows dated in the period for "collected": it counts money for sales of other
  periods and cannot be reconciled with the sales shown (SH2).
- Adding the paid and due columns in the web from the lists of payments and allocations: the
  customer-screens decision ruled out adding money up outside the core account.
- A paged query on the database: the whole history is on the device and the figures need every row
  of the period anyway; only the rendering is paged. At around 100 000 sales the list should move to
  a date-bounded Dexie query (the `date` index exists).

## Consequences

- `SaleSummary` gained `paidCents`, `writtenOff` and `overdue`; `dueCents` is the account's.
- The filters are not in the URL and are not kept when leaving the page: opening an invoice and
  coming back shows the default view.
- "Today" is read when the page renders; a page left open past midnight updates on its next render.
