# ADR 0015: The supplier workspace

Status: accepted (assumptions SP6–SP9).

## Context

Supplier debts were spread over three screens: a "who we owe" list, a statement page and a supplier
list inside the catalog. The list showed one balance, the statement a bare table, and the payment
form a free amount. Nothing said what had been bought from the supplier in all, what was paid, or
where a payment went, and a supplier with nothing owed could not be found from the payables at all.

## Decision

- **Every figure comes from `supplierAccount` in `@fabric/core`.** The account gained what the
  screens needed so that the web does not add anything up: `purchasesCents`, `paidCents` (at
  purchase and since) and `allocations` (where each payment went; a part with no purchase is an
  advance), with tests. `features/payables/supplier-view.ts` only names, filters, orders and joins
  what the account carries (status, purchase and payment rows, the activity timeline).
- **A directory and a workspace.** `/payables` (also `/inventory/suppliers`) lists every supplier
  with the suppliers, the ones owed and the total owed, search, the filters All / With debt /
  Settled and a sort. The profile (`/payables/view?id=`) is a header (who, the one gold action
  "Record a payment", share, edit, owner-only "more"), three figures (total purchases, total paid,
  we owe) and five sections: Overview, Purchases, Payments, Activity, Details. A purchase links to
  `/purchases/view`, which links back to its supplier.
- **One payment path.** The dialog is `repositories.supplierAccounts.pay`; it now previews
  (`previewSupplierPayment` in `@fabric/contracts`, the same check and account as the save) where
  the money goes and what stays owed, refuses an amount above what is owed inline (SP3), and does
  not submit twice. No second payment system.
- **Statement.** Previewed in a dialog before it is shared, and the closing balance is the
  account's balance (SP8).
- **Same-day order.** The statement keeps the order of the records it is given, each purchase with
  what was paid with it, then the payments; contracts give them
  in the order they were recorded (SP6).
- **Archiving** is the existing void of the supplier, owner only and only when settled (SP7).

## Consequences

- `SupplierAccount` has new required fields; fixtures that build it by hand carry them.
- `supplierStatement` no longer sorts same-day, same-kind lines by id; anything calling it with
  unordered records goes through `supplierStatementOf` or orders them itself.
- The old payables list, statement screen and catalog supplier list, with 13 catalog keys, are gone.

## Amendment (2026-11-13): the suppliers a product is bought from

The owner asked that, from the product page, the stock can be edited and suppliers can be added to
the product. Stock editing needed no new rule: "Edit stock" opens the existing stock count
(`repositories.stock.act`, an `adjustment` move), because stock is append-only batches and moves
(ADR 0012) and is never edited in place. The suppliers needed a place to live.

- **A list on the product.** `product.supplierIds` is an array of supplier ids (`uuid[]` in
  Postgres, `supplierIds` in `@fabric/contracts`, default `[]`, at most 30, each id once). It is the
  owner's own note of who to reorder from. No purchase, cost or debt depends on it and no supplier
  balance changes when it changes. There is no foreign key (Postgres has none for array elements);
  a supplier is only ever cancelled, never removed, and the page leaves a cancelled one out.
- **A cashier never receives it.** A supplier is `NOTHING` for a cashier (SPEC §11), and a name on
  a product would give the buy side away. `product` is now a `redacted` entity in `CASHIER_ACCESS`:
  `redactForRole` sends the product to a cashier's device with `supplierIds: []`. The cashier's
  pull of the product table therefore never contains a supplier id (tested in
  `apps/api/test/roles.e2e-spec.ts`). The cashier still cannot push products.
- **Rejected: a synced join entity** (`product_supplier`). It would have needed its own handler,
  Dexie table, lock dates and cashier rule for a list of a few ids that is always read with its
  product.
- **Devices.** Dexie version 17 fills `supplierIds: []` on the product rows already on a device
  (`upgradeToProductSuppliers`); the server's rows did not change sequence, so no pull would bring
  the field, and every reader would otherwise have to guess.
- **Every internal save keeps the list.** `inputOf` in `local-db/product-inventory.ts` builds a
  product's full input from the stored record; restock, the measurement follow-up, the form dialog
  and `setSuppliers` all go through it or pass the field on, so an edit never wipes the suppliers.
- **A new purchase starts with the product's supplier** only when the product has exactly one.
  With none or several, the supplier stays empty and the owner chooses. A choice the owner already
  made (even "none") is never replaced.
- **Who sees the section.** The "Suppliers" section is for those who see costs (owner, partner);
  only the owner edits it. A supplier can be made on the spot from the section.

## Amendment (2026-11-14): correcting what was paid on a purchase

A purchase entered as "paid in full" when the shop really paid 1,000 dh of 5,000 dh left the
supplier owed nothing, and nothing in the app could fix it: a purchase is made with its stock and is
never rewritten. The owner asked for a way to edit it. The rule is SP9 in
`docs/accounting-assumptions.md`.

- **A change of the record, not a new record.** `purchase.paidCents` is what every reader uses
  (the supplier account, the day's cash count, the integrity check, zakat through the account). Only
  `paidCents` (and the supplier, where there was none) changes, so all of them follow without being
  touched. `checkPurchaseAmend` in `@fabric/contracts` is the one check: every other field must be
  as it was, a supplier is never swapped, and the payment rules of a new purchase still hold (not
  above the total, a debt needs a supplier). The server's handler and the device both call it.
- **A new sync capability, `amend`.** `purchase` stays `append_only`: it is created by the one
  `append` op that carries its batch and move, and it can still never be voided. An entity marked
  `amend: true` in `SYNC_ENTITIES` also accepts an `upsert` of its own record, which only changes an
  existing row (a missing one is refused with `not_found`), through the handler's `write`. The
  existing last-write-wins rule, the period lock (`periodDatesOf` now reads a purchase's own date as
  well as an aggregate's) and the audit entry (`update`, with before and after) apply as for any
  mutable entity. `product_batch` has the same shape for its remnant mark.
- **Offline.** `repositories.purchases.setPayment` writes the record and the outbox op in one local
  transaction (`PurchasePaymentTable`, a `SyncedTable`), so the correction works at the till or on a
  phone without a connection. `previewPayment` shows what the correction leaves with the same check
  and the supplier account of core.
- **Cashiers.** `purchase` is not in `CASHIER_ACCESS`, so the push is refused with `forbidden`
  (tested in `apps/api/test/roles.e2e-spec.ts`); a partner reads only.
- **Rejected:** a REST route that works only online (a correction made while offline would be lost
  or the form would be useless at the till); a `purchase_correction` entity applied at read time
  (every reader of `paidCents` would have to learn it, and two answers would exist until they all
  did); making `purchase` a mutable entity (it would allow its stock-bearing fields to change).
- **The form no longer reads an empty field as "paid in full".** The restock form asks "Paid in
  full" or "Paid part, the rest is owed", and the amount is required for the second. The product
  page shows each batch's purchase with what is still owed on it and a menu item that opens the
  correction.
