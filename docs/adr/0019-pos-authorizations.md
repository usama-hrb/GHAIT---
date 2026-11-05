# ADR 0019: Authorizations at the till, and no profit on the selling screens

Status: accepted. No accounting rule, stored figure, contract, schema, sync handler or server check
changed; the rules this records are rows PA1–PA4 in `accounting-assumptions.md`.

## Context

Selling under the product's minimum price needs the owner ([ADR 0012](0012-product-batches-single-stock-source.md)):
the line stores `minOverrideBy` and the audit log says why. Selling under the cost needs the owner's
`confirmedBelowCost` on the sale (P8). Both were asked, and badly:

- The line dialog's switch for the minimum was not tied to the price it was switched on for. Confirm
  at 340, change the price to 330 or 300, and the confirmation stayed.
- A line under both rules was confirmed for the minimum in the line dialog and then asked again, for
  the cost, in the payment dialog. The owner saw the same warning twice.
- The line dialog, every cart card and the invoice footer showed the profit (and "provisional
  profit"), to the owner and the partner. The till is where one sells, not where one judges a sale.
- The line dialog grew and shrank with its warnings; at 1280×800 the line total fell below the fold.

## Decision

1. **Ask once per rule, where the price is typed.** The line dialog shows, under the fields, one
   compact strip per rule the line breaks: the minimum (with the minimum price) and, for the owner, the
   cost. Each has its own switch whose whole row is the tap target. Adding the line stays disabled until
   every strip is confirmed, and also while the line is being priced, so a cost confirmation is never
   asked late. A cashier gets the minimum strip without a switch and cannot add the line.
2. **A confirmation belongs to a price.** `priceKeyOf(unit, price)` (`features/pos/cart.ts`) names the
   unit and the exact per-unit or whole-piece price. The dialog drops both confirmations when the key
   changes and asks again. A new line, or a removed and recreated one, is a new dialog and starts with
   none; editing a line keeps its own while the price is untouched. Each line carries its own, so
   several lines under the minimum are confirmed one by one.
3. **Payment asks only for what no line could.** `needsCostConfirmationAtPayment` is true for a
   below-cost line nobody confirmed and for a discount that takes the invoice under its cost. In every
   other case Pay saves the sale at once, with `confirmedBelowCost` equal to "the invoice is under its
   cost" (the owner confirmed each line behind it). The payment dialog uses the same `Authorization`
   strip, with the sentence that explains the loss.
4. **The trust boundary does not move.** `CartItem.belowCostConfirmed` is screen state, never sent. The
   repository prices the sale again with the device's costs when it saves it, and the server with its
   own: it reads the minimum from its product record, refuses an override that does not name the
   signed-in owner, refuses an unconfirmed under-cost invoice, and refuses a cashier's push that carries
   `confirmedBelowCost`. A client boolean never replaces those checks.
5. **No profit on the selling screens.** `PricedItem` carries the total, the warnings and a `belowCost`
   flag, no `profitCents` and no `provisional`. The cart card shows the authorization as a status. The
   invoice footer shows lines total (only with a discount), discount and one total. Profit stays on the
   sale's page, the history, the reports, Home and the settlement, and in the core and the contracts.
6. **A line dialog of one height.** Header (picture, name, stock, normal price), a scrolling body (fields
   and, from md up, the keypad beside them), the strips pinned above a footer that holds the line total
   and the actions. The height is `min(46rem, 100svh − 2rem)` whatever the line shows, so nothing moves
   when a total or a warning appears.

## Tried and not chosen

- A server-issued authorization token per line: offline-first sales cannot wait for a round trip, and
  the owner is already signed in on the device.
- A `confirmedBelowCost` per line in the contract: it changes the sale's schema and the sync for no
  rule the invoice-level flag (P8) does not already enforce.
- Keeping the payment confirmation and removing the line one: the owner would confirm a price before
  seeing the discount, and the discount-induced loss would have no place to be asked.

## Consequences

- A cashier's device has no costs, so it cannot know a line is under its cost. If a product's minimum
  is below its cost, only the server's check on push catches it. Unchanged; reported, not hidden.
- The i18n keys `pos.provisional`, `pos.bill.belowCost` and `pos.minimum.owner` were removed; the sale
  page keeps `pos.profit` and `pos.columns.profit`.
