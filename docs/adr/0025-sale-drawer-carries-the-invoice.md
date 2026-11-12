# ADR 0025: The sale drawer carries the whole invoice and its actions

Status: accepted. A screen change only: no contract, schema, sync handler, stored figure or server
check changed. It replaces the second decision of [ADR 0020](0020-sales-history-workspace.md), which
kept the drawer to a quick look and sent the owner to the invoice page for payments, returns and
voiding.

## Context

The sales history showed a sale in a drawer, but the drawer was only a summary. To take a payment,
return goods, void the sale, see which batch a line came from or see its profit, the owner had to
leave the list for the invoice page and come back to the default filters (they are not kept). The
table also ended every row with a receipt icon whose only job was to open that page.

## Decision

1. **The drawer holds everything the invoice page holds.** Besides what it already showed, it now
   shows the batch of each line, the minimum-price override (who confirmed it and the price it went
   at), the profit of each line, the sale's cost and profit, the capital and the profit recognized by
   each payment, the reason and the goods of each return, and the reason for a write-off. The cost and
   the profit follow the invoice page's rule: they show to the owner and to a partner, never to a
   cashier (`useCanSeeCosts`; the API sends a cashier none).
2. **The actions are at the foot of the drawer.** Share, WhatsApp, record a payment, return goods
   and void, with the same conditions as before: a payment needs a customer and an amount due, a
   return is the owner's and needs something left to return and no write-off, and a void is refused
   once goods were returned or its period is settled (the reason is shown instead). A voided sale has
   no actions.
3. **The row's receipt link becomes an Actions menu.** The last cell of the table opens a menu with
   the same actions plus View details. The menu reads the sale when it opens, so the list reads
   nothing per row. Cards (a phone, a tablet held upright) have no menu: the whole card opens the
   drawer, whose foot carries the actions.
4. **One place decides what is offered.** `saleOptionsOf` (`features/pos/sale-actions.tsx`) is read
   by the invoice page, the drawer and the row menu, and the dialogs (payment, return, void) are
   mounted by one component, `SaleActionDialogs`. The history mounts it beside the list, so a dialog
   opens over the drawer and the drawer shows the result when it closes.
5. **The invoice page stays.** Customer pages, the home screen, the integrity report and the stock
   movement history link to `/pos/view?id=`, and the record page keeps its `?id=` route so the service
   worker and offline keep working. The sales history simply no longer links to it.

## Alternatives rejected

- Deleting the invoice page: other screens link to it and deep links must keep working offline.
- A second copy of the page's table inside the drawer: the page's lines table needs more width than
  the 34 rem drawer has on a desktop (its phone layout depends on the window, not on the drawer), so
  the drawer lists the lines instead and adds the missing facts to each.
- Loading each row's sale to decide its menu: the list would read every sale's lines and payments.
- An actions menu on the cards: a card is one button, and a menu inside a button is not valid.

## Consequences

- The drawer now shows costs and profit to the owner and a partner. The earlier test that asserted
  the opposite was changed to assert this, and a test for the cashier asserts that the drawer shows
  neither a cost nor a profit nor a return action.
- The end-to-end helper `openLastSale` reads the id of the first row (`data-sale-id`) and opens the
  invoice page by its address, because the history has no link to it any more.
