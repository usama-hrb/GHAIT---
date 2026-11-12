# ADR 0028: The Zakat Management Center: a status overview, a guided review that records nothing, and payments that are safe to repeat

Status: accepted. No database migration, no new synced entity and no new REST route. The accounting
is unchanged: `computeZakat` ([packages/core](../../packages/core/src/zakat/index.ts)),
`zakatPositionOf` and `zakatReportFieldsOf` produce every figure exactly as before, and a saved
report is never recalculated. What changed is the overview and review screens, read-only helpers in
`@fabric/contracts` that name the state and the items to look at, the server's check that a report
is for a hawl that has come, payments that can be sent twice without being recorded twice, and the
refusals on the device. Eight
assumptions the code already made are now written into
[accounting-assumptions.md](../accounting-assumptions.md) as `open` rows (Z11–Z18); this change
decides none of them.

This is a calculation tool, not a fatwa (SPEC §10, §17.1). Nothing here rules on a religious
question: where the spec is silent the screens say what the app does and leave the choice to the
owner.

## Context

The zakat page was one screen: the methodology form on top, the live figures under it and a "report
archive" at the bottom. A review of SPEC §10, assumptions Z1–Z10, the core function, the contracts
helpers, the device repository, the API module and the screens found the following.

Confirmed bugs, all fixed:

- **G1.** The server accepted a report for a hawl that had not come. It re-ran the core function on
  the figures the device sent, which proves the figures follow from the items, but it never looked
  at `hawlCompleted` or at the hawl date, so a report with `hawlCompleted = false`, or for a hawl
  next year, was stored.
- **G2.** Paying was not safe to repeat. A second tap, or a retry after a lost answer, recorded the
  payment again, one more draw per partner. The only brake was "never above what is due".
- **G3.** A partner was offered the controls that change the methodology, save a report and record
  a payment. The device and the server refused the write, but the screen offered it.
- **G4.** A device that had never received the shop's records held no sales, no stock and no
  money, so it worked out a base of zero and offered to save it as a report.
- **G5.** The methodology form sent every setting on every save, so saving one field rewrote the
  rest; a price could be saved without its date; two quick taps on Save could race into two reports
  (the second was refused only afterwards); and the figures a person confirmed could differ from the
  ones saved when records arrived by sync in between.

Data-quality findings, where the calculation is left as it was and the review now says so (each is
an assumption row, not a change):

- A product with no selling price counts as zero under the market valuation (Z12).
- Money on hand below zero in the records counts as zero in the base (Z15).
- Weight stock still waiting for its length is counted at its cost, because there are no metres to
  price (Z11).
- A piece is valued at its piece price, while Z1's text says per metre (Z16).

Methodology choices the spec leaves open and the screens now show instead of hiding (Z13, Z14,
Z17): no rule on how old the metal price may be, bills recorded and not paid are not deducted, and
the nisab is tested once, when the report is made. The review also states, without changing them,
the rules that were already decided: the market value is the shop's reference price (Z1), receivables
count at the full amount owed (Z2), every supplier debt and customer credit is deducted, and the
hawl follows the Umm al-Qura calendar (Z8), which can differ by a day from a local moon-sighting
announcement.

## Decision

1. **The overview says where the hawl stands, in one of eight states, from records and settings
   only.** `zakatStatusOf` returns _not configured_, _waiting for the hawl_, _hawl in progress_,
   _nisab not reached_, _review required_, _zakat due_, _calculation completed_ or _payment
   recorded_. A reminder never makes zakat due: "due" needs a start day, a completed hawl, a metal
   price, records on this device, no item that blocks the calculation, and a base at or above the
   nisab. The amount shown before a report is saved is labelled an estimate. Four compact cards sit
   under the state: the hawl (its start, the latest and the next hawl, the days gone and left), the
   nisab (the threshold, the base today, reached or not), the base (the estimate, or the saved
   report's) and the zakat (estimated or due, and what is paid). The history of reports follows.
2. **One primary action: "Review Zakat calculation".** It is the only gold accent on the overview.
   Reviewing the methodology, the history and recording a payment are secondary.
3. **The review is read-only and has seven steps:** settings, the base by category, the inventory
   valuation audit, the nisab, the hawl, the result, and the confirmation. `zakat.review()` reads the
   device's records and writes nothing, so leaving at any step leaves no trace. Each category of the
   base says whether it is added, deducted, left out by a setting or not tracked, with its source,
   the records it is made of and a flag where its figure is incomplete. The goods audit shows each
   batch's cost, the way it was valued and the value used.
4. **A calculation says what to look at, in three severities.** `zakatReviewOf` lists items that
   _block_ the calculation (no hawl start, no metal price, records not received on this device),
   items that _need review_ (a price dated in the future or before the hawl, goods with no price,
   weight awaiting measurement, negative money) and items that are _good to know_ (the records are
   read as of today, doubtful debts, unpaid bills). It has no threshold of its own: a price is
   flagged only when its date is after today or before the hawl it serves, never because it is "old"
   (Z13). A blocking item removes the estimate, because a figure from empty books would be wrong,
   and blocks saving.
5. **Saving needs an explicit confirmation and is guarded twice.** The last step shows what will be
   saved. The button appears only when nothing blocks the report; the owner ticks that the settings,
   the base and the valuation were reviewed, and that each item marked for review was looked at.
   `zakat.save(expected)` on the device then refuses when the shop's records were never received,
   the hawl has not come, a live report already exists for the hawl, or the figures differ from the
   ones confirmed on screen (`zakat_figures_changed`; the screen shows the new figures to review
   again). The server re-checks on every report it receives (`checkZakatReport`): the figures follow
   from the items by the core function, `hawlCompleted` is true, and the hawl date is not more than
   one day after the server's own day (the day absorbs a device in another time zone). One live
   report per hawl is also a partial unique index in the database.
6. **A saved report is history and is shown exactly as saved.** It keeps its own settings, metal
   price and breakdown and is never recalculated. It is never edited: a correction is a void with a
   reason, allowed only while nothing is paid on it, followed by a new review and report. A voided
   report stays in the history, marked as voided, and takes no payment. The history replaces the
   "report archive": every report is listed with its hawl, its figures and its payment state, and
   opens as saved. Sharing is WhatsApp text only (CLAUDE.md), with the figures as saved, the paid and
   remaining amounts and the note that this is not a fatwa.
7. **A payment is a partner draw, not an expense, and can be made in parts.** It has a date, an
   amount and a note or reference (up to 200 characters, kept in the draw's `reason`). It is shared
   between the partners by ownership (Z7, Z18) and linked to the report; what is paid and what is
   left are derived from the live draws, as before, with no stored `paid_cents` and no second ledger.
   A payment above what is left is refused on the screen, on the device and on the server.
8. **A payment is recorded once, however often it is sent.** The dialog makes a `paymentId` when it
   opens. The draws of a payment get ids made from it and the partner's id (`zakatDrawIdOf`), the
   same on the device and on the server. Sending the same payment again, by a second tap, a retry or
   the device's copy arriving through sync after the owner's online one, finds its draws and
   changes nothing; the same id with another amount or day is refused (`zakat_payment_id_reused`).
   On the device the draws of one payment are written in one Dexie transaction, all or none. On the
   server `ZakatService.pay` runs its own transaction, and every write transaction takes the same
   advisory lock, so two payments never read the same "paid so far". `paymentId` is optional in
   `newZakatPaymentSchema`, so a client that does not send it behaves as before.
9. **`POST /zakat/reports/:id/payments` is `@AuditExempt`, with the reason written.** A mutating
   request commits only if it wrote an audit entry ([ADR 0004](0004-api-foundation.md)), but a
   repeated payment correctly writes nothing, so the rule would answer a correct retry with an error.
   The service opens the transaction itself and saves each draw through `SyncService.saveDirect`,
   which writes its audit entry in that transaction, the first time only.
10. **Roles are enforced where they always were.** The owner alone saves the methodology, saves and
    voids a report and records a payment. A partner reads the overview, the review up to the
    confirmation (which says only the owner saves and shows no save button), the history and every
    report, from the records on its device: there is no REST detail for a partner
    (`GET /zakat/reports/:id` is `@OwnerOnly`). A cashier has no zakat page, and the server answers
    403 on every zakat route because none is marked `@CashierMayCall()` ([ADR 0007](0007-returns-payables-roles.md)).
    The device repository refuses the same writes for a partner.
11. **The methodology settings are their own page, away from the overview.** `/zakat/settings`
    groups them as Methodology, Hawl and Market prices in collapsible sections, each saying that a
    change affects future calculations only, never a saved report. A save sends only the fields
    that changed, a metal price and its date go together, and the reminder is 0–60 days. The
    settings stay server-owned and are written online like the others (Z9).
12. **It all works offline.** The overview, the review, saving, voiding and paying read and write
    the device's database through `local-db` and reach the server through the outbox and sync. The
    four zakat routes are in the service worker's shell pages so they open without a connection.

## Alternatives rejected

- **Recompute a report on the server from its own records, so the server is the authority on the
  figures.** A report is the shop's position at the moment a device saved it (Z6); replaying the
  books to that moment is not possible from the current rows. The server instead proves what it can:
  the figures follow from the items, the hawl has come, one live report per hawl, and it stores the
  report as sent. Recorded below as a limit.
- **A `status` or `paid_cents` column on the report.** It would be a second ledger that can
  disagree with the draws (CLAUDE.md: balances are derived). The status and the paid amount are
  worked out from the records each time.
- **Editing a saved report, or refreshing its figures when the settings change.** It would rewrite
  history. A report is voided and replaced, and both stay in the audit log.
- **Booking the payment as an expense.** SPEC §10: zakat is deducted from each partner's account by
  ownership, not charged to the shop (Z7).
- **A payment method or a recipient field.** The app has no beneficiaries and the spec has no such
  field; adding one needs a schema change and a spec decision. The note carries a reference.
- **An idempotency-key header and a table of keys on the server.** Ids made from the payment's own
  id give the same protection with no table, and they also protect the offline path, where the
  payment reaches the server through sync rather than through the route.
- **A row lock on the report for the payment.** Every write transaction already holds one advisory
  lock, so payments are already serialised.
- **Charts of the base.** The categories are cards with progress bars: the brief and the design
  rules ask for no decorative charts, and the figures matter more than their shape.

## Consequences

- The contracts gain `zakat-center.ts` (`hawlClockOf`, `zakatReviewOf`, `zakatBaseCategoriesOf`,
  `nisabCheckOf`, `zakatStatusOf`) and `zakat-payment.ts` (`zakatPaymentStateOf`, `zakatDrawIdOf`,
  `newZakatPaymentSchema`, the note limit and the reason text), and `ZAKAT_ISSUES` gains keys. They
  only read: the base, the nisab and the amount due still come from `@fabric/core`.
- No migration. An existing shop keeps its reports and payments; a payment made before this change
  has a random draw id and is simply never matched by a retry.
- Reports saved before supplier debts were deducted (SP4) show no supplier debts in their breakdown.
  They are shown as saved; recalculating them would be the rewriting the design refuses.
- The tests: the contracts helpers and the payment rules, the device repository (24 tests), the
  feature screens, the API integration spec (a report only for a hawl that has come, a payment sent
  twice, an id reused for another amount, a partner who reads but cannot pay or void) and one
  Playwright spec that walks the whole flow with the device offline and checks that a cashier gets
  no zakat page and a 403 from each zakat route. The partner's read-only view is checked in the
  accounts spec, and the four zakat routes are in the responsive audit's route list.

## Observations left as they are

- **Payment method and recipient are not kept**; only the note is.
- **There is no price history.** The metal price is the one typed in the settings; each report keeps
  its own copy.
- **Reserved or unsellable stock cannot be marked**, so all stock on hand counts as goods, and other
  zakatable assets (investments, metal held) are not tracked: the base shows them as not tracked.
- **Two devices offline can each pay what is left.** Both payments reach the server through sync and
  are kept (draws are append-only), and the report then shows "paid beyond what is due". Voiding a
  payment's draws is the correction.
- **Voiding a report that is already voided, through the REST route, writes no audit entry**, so
  the interceptor's rule turns the repeat into an error instead of an unchanged answer. Found by
  reading `voidDirect` and the interceptor; not run, not zakat-specific, and not changed here. The
  screen offers no second void.
- **The server validates, it does not re-derive** (see the first alternative above).
