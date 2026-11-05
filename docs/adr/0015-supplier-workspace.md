# ADR 0015: The supplier workspace

Status: accepted (assumptions SP6–SP8).

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
