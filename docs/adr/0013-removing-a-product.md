# ADR 0013: Removing a product from the inventory

Status: accepted (assumption PB20).

## Context

The Inventory needed a "Delete product" action. The system forbids hard deletes: the database
refuses `DELETE` on every table, stock moves, sale lines, payments and returns are append-only, and
balances (stock value, supplier balances, partner capital) are derived from movements. A product is
referenced by batches, stock moves, sale lines, returns, losses and photos, and past sales and
reports read it by id even after it is gone from the lists.

## Decision

- **Delete means cancel.** The product gets `voided_at` and `active = false` with a required
  reason, exactly like any other record, through the existing void path: `SyncedTable.void` on the
  device, a `void` op in the outbox, `SyncService.void` or `POST /products/:id/void` on the server,
  audit-logged with the reason. Readers of history keep resolving the product by id.
- **Only a product that holds no stock may be cancelled** (PB20). "Holds stock" is
  `productHoldsStock` in `@fabric/core`: any available quantity in any unit, any weight awaiting a
  length, or any cost still on a batch. `checkProductRemoval` in `@fabric/contracts` turns it into a
  validation issue (`product_holds_stock`) that the device and the server share. Cancelling a
  product with stock would remove value from the stock total with no sale or loss to explain it.
  The owner records the sale or the loss first; the books stay exact.
- **Nothing cascades.** Batches, stock moves, purchases, sales, returns, payments and supplier
  balances are not touched. Photos are not cancelled either: they are only referenced, and keeping
  them costs nothing.
- **The server enforces it**, not only the dialog. `SyncRegistry` has a per-entity `VoidGuard`
  hook (`addVoidGuard`, `assertCanVoid`), run inside the void's own transaction for both the REST
  route and a pushed void op. The stock module, which owns batches, registers the product guard on
  start-up, so `products` and `sync` need no import of each other's internals. A refusal is a
  `SyncRejection('validation_failed')` carrying the issue, which a device shows in its sync issues.
- **Roles are unchanged.** Only the owner may void a product: a cashier's route and pushed op are
  refused (`mayPush`), a partner is read-only. The UI hides the action from them.
- **Offline.** The device checks the rule against its own batches and moves, and saves the void
  and its outbox op in one local transaction (`ProductInventoryRepository.remove`). The outbox keeps
  order, so a sale queued before the deletion is applied first. The server re-checks on sync: if
  stock arrived from another device meanwhile, the void is rejected and surfaces in the sync issues
  for the owner to decide, like any rejected op.

## Alternatives rejected

- **A real `DELETE`** of the product and its dependents: forbidden by the row guards and by
  CLAUDE.md, and it would break past sales, reports and settlement periods.
- **Cancelling a product that still holds stock**, writing a compensating loss automatically: it
  invents an accounting entry (a loss at cost) the owner never decided. Refused until the owner
  asks for it.
- **A guard inside the product's own module**: the batches belong to the stock module, so the rule
  would need its internals. A registry hook keeps the module boundaries.

## Consequences

- The Inventory's row menu has a destructive "Delete product" item for the owner. Its dialog names
  the product and its code, says what stays, asks for a reason, and cannot be confirmed while the
  product holds stock.
- A product cancelled by mistake is not restored by the app; restoring would be an explicit,
  audited action to add later.
- Any future synced entity can register its own `VoidGuard` the same way.
