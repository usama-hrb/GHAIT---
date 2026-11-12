# ADR 0027: Financial Integrity gives one of three answers, and the navigation is grouped

Status: accepted. A screen and navigation change only: no contract, schema, sync handler, stored
figure, role rule or server check changed, and the integrity function (`integrityReportOf`, SPEC §9,
[ADR 0006](0006-integrity-and-audit-on-devices.md)) is the one that was already there. Nothing here
adds an accounting rule, so [accounting-assumptions.md](../accounting-assumptions.md) is unchanged.

## Context

The integrity screen answered with one box: matched, or different by an amount. Three things were
wrong with that.

- A device that has never received the shop's records holds none, so its empty records add up to
  nothing and the box said the shop was balanced. That is not a check. A device whose records were
  incomplete (a sale that lost its cost, for example) made the check throw, and the whole page fell
  into the global error boundary.
- The line called "money per the records" was read as the money in the till, which it is not: it is
  worked out from every recorded payment, expense and withdrawal, till and bank together
  ([assumption I5](../accounting-assumptions.md)). Nothing said so.
- The latest changes showed one date. A person looking for the entry that broke the balance needs
  two: when it was saved, and the day it counts for in the books, which differ for a late entry.

The sidebar listed twelve pages in three unlabelled groups, with Financial Integrity as a page of
its own beside Reports, although it is a report.

## Decision

1. **Three answers, each in words, with an icon and an edge colour as second signals.** _Balanced_
   only when the check says it is and the exact difference is zero; one cent is a difference, and the
   sign is kept (positive: the shop holds more than the records explain; negative: less). _Difference
   detected_ shows the exact amount, what it means, and a link to the latest changes. _Unable to
   verify_ shows no figures at all. The three figures (total held, total belonging and owed,
   difference), when the check was worked out, when the shop's records were last received, the changes
   not yet sent, and the basis of the check sit under the answer.
2. **"Unable to verify" has two causes, both decided on the device.** `PULLED_AT` is a meta record
   written at the end of every complete pull; `maintenance.lastPulledAt()` reads it. Never written:
   the device has not received the shop's records. The check throwing on incomplete records is caught
   by the screen and shown as the second cause, with a button to check again. No staleness threshold
   is applied: how old is too old is a policy, so the screen shows the time of the last pull instead.
3. **Two sides, side by side only where there is room.** What the shop holds (money per the records,
   stock at cost, capital tied up in customers' debts) against who it belongs to and what it owes
   (the partners' capital and undrawn profit and the open period's profit; credits owed to customers
   and supplier debts). Each line has a short explanation and each side its total, so the totals are
   visible when the sides stack on a phone; the verdict repeats them. The arrangement follows a
   container query at 48 rem of the page's own column, not the screen, because a tablet in portrait
   spends a third of its width on the sidebar. The money line carries a folded explanation of how it is
   worked out, and the four lines whose negative amount has a meaning of its own (money, the partners'
   balance, the open period, supplier debts) say so under the amount.
4. **Cash counts and latest changes read as sections of their own.** A count's result is a word and
   an amount (matches, surplus, shortage), never a colour alone. The one button that makes a count is
   in the header, or in the empty state when there are no counts, and is disabled while the device has
   no records to count against. Voided and locked counts are marked and cannot be voided again. The
   latest changes name the change, say what it did to the shop's money and link to the record when it
   has a page, show _Recorded at_ and _Transaction date_ as two columns (cards on a phone), and end
   with a link to the audit log, which has the full history and the account that did each thing.
5. **A section that cannot be read does not take the page with it.** Each section reads through a
   guard that turns an exception into an error state with a retry, so the verdict still shows when
   the cash counts cannot be read.
6. **The navigation has five groups and one nesting level.** Main (Home, Sell, Stock, Customers, the
   phone's four tabs), Operations (Suppliers, Expenses), Finance (Settlement, Zakat), Reports
   (Reports, with Financial Integrity under it) and Administration (Audit log, Settings). Each group
   has a heading except Reports, whose first item says what it is. A page that names a `parent` is
   drawn indented under it, in the sidebar, in its folded rail (the two icons stay in line) and in the
   phone's drawer. `nestNav` nests one level: a page whose parent is not in the role's list, or whose
   parent is itself nested, stays at the top level, so a page a person may open is never hidden. The
   open page is the burgundy pill; its parent is darker while the page under it is open. The route
   `/integrity` is unchanged, the standalone entry is gone, and who may see what is unchanged (the
   audit log, the integrity page and the accounts stay owner-only).
7. **The name is Financial Integrity** (`التطابق المالي` in Arabic). SPEC §9 and the sections that
   quote it still say `فحص التطابق`; the spec is the owner's and is not edited here.

## Alternatives rejected

- Treating a device as unable to verify when its last pull is older than some limit: the limit would
  be an invented rule. The time of the last pull and the number of unsent changes are shown instead.
- Hiding the two sides until a difference appears: the person who must trust a "balanced" answer needs
  to see what it is made of.
- Tabs for the sides, the counts and the changes: the answer to "why does it not balance" is spread
  over all of them, and tabs hide most of it.
- Collapsible groups in the sidebar: a destination folded away costs a tap on a till tablet, and the
  groups are short.
- A new route under `/reports`: bookmarks, the service worker's precache and the e2e specs know
  `/integrity`.

## Consequences

- A device with no records can no longer be mistaken for a balanced shop, and a broken record can no
  longer blank the page.
- The owner's menu (twelve pages and four headings) fits a desktop window of 1440×900 with 41 px to
  spare and a tablet in portrait (800×1280) with room to spare, measured in a browser with the
  sidebar open and folded. On a tablet in landscape (1280×800, touch-sized rows) it is 728 px in the
  597 px the sidebar leaves it: the menu scrolls inside the sidebar, the header and the sign-out
  button stay in place, and Settings starts 119 px below the fold. The headings and the nested page
  add about 110 px to what the old menu needed, which already overflowed there by a few pixels
  (worked out from its twelve rows and three groups, not measured). A cashier's menu (five pages)
  fits. Keeping Administration in view while the rest scrolls is a follow-up, not done here.
- The phone's More drawer lists the eight pages that are not tabs under three headings, 464 px in
  all. Its rows are 44 px tall (the touch size of the sidebar's rows) and it may grow to 88% of the
  screen height instead of the drawer primitive's 80vh, which cut Settings off on a phone of 812 px
  (32 px below the fold, and 106 px on a phone of 720 px). Measured in a browser, the whole list now
  shows without a scroll on phones 375, 390 and 430 px wide (812 px tall or more); on a phone of
  320×720 it shows 448 of the 464 px and scrolls, with Settings 16 px below the fold. The cap has to
  carry the primitive's own `data-[vaul-drawer-direction=bottom]:` prefix: a plain `max-h-*` class
  has lower specificity and loses to it.
- The name of a change that opens a record is a link as narrow as its word: "Sale" is 29 px wide and
  the Arabic "بيع" 18 px. The link therefore has a minimum size in both directions, 24 px with a
  mouse and 44 px on a touch screen. The browser audit found this only after its seed was made to
  wait until the sale had reached the server; before that, the devices it opened had no sale in
  their lists, and the audit passed with the narrow link in place.
- The check, its keys and its order are the contract's; the screen lays out the keys it knows
  (`LINE_GROUPS`), and a test fails if a key is added to the check without a place on the screen.

## Observations left as they are

These were met while building the latest-changes list. Each is how the records or the contract work
today, not something this change should alter, and none is a defect of the check.

- A sale's amount in the list is the invoice total, not the cash received; a settlement's amount is
  the net profit it distributes. Neither moves cash by that amount.
- An expense not paid yet carries a negative amount in the records although no money moved. The list
  shows it without the minus.
- Profit the partners leave in the shop is recorded as a capital move with a positive amount, although
  no cash moves.
- A cash count does not carry the account that made it; the audit log does.
- A supplier payment links to its supplier's page, not to a page of its own.
