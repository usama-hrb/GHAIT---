# ADR 0007: Returns, supplier payables and roles

- Status: Accepted
- Date: 2026-10-31

## Context

BUILD_PROMPTS 5.3: returns (stock back to the roll, refund or reduce the debt, reverse profit proportionally), supplier payables (what is owed, a statement, their effect on the integrity check and zakat) and roles (a cashier who sells without seeing costs or profit, enforced on the API). The accounting rules are `docs/accounting-assumptions.md` RT1–RT8, SP1–SP5, RL1–RL5; this records how they are built. Three constraints shape it:

- Records are append-only and balances are derived (CLAUDE.md "Data rules"). A return cannot edit a sale; a payable cannot be a stored number.
- A closed period never moves (ADR 0005). A return of a March sale made in April must not change March.
- A device keeps a copy of whatever the server sends it (ADR 0002). Hiding a column on a screen does not hide it from a device that holds it.

## Decision

### A return is a credit note, and everything else is derived

`sale_return` is an append-only record: the sale, the date, the reason, the lines and lengths given back (each with the id of the `return` stock move that restores it), the credit and the refund payment. It travels as **one op** with its moves and refund (`saleReturnAggregateSchema`); the device builds it with `buildSaleReturn`, and the server rebuilds it from its own records and refuses a difference (`checkSaleReturn`), as it does for sales and voids.

- **Length and cost.** The roll ledger (`rollLedger`, core) treats a `return` move as giving back the same share of its sale's cost as of its length: cumulative proportions with the last return taking the remainder (`shareOfLineCents`), so any number of returns add up to the sale exactly. The share comes from the sale's cost on the ledger, or from the cost a settlement froze for it, which is the cost **before** returns; so a later measurement cannot move a closed month.
- **Value.** `returnCreditCents` (core): the proportional price of the returned length per line, the invoice discount shared in proportion to what is kept. The invoice is worth its total less its live returns' credits; no record of the sale changes.
- **Money.** `effectiveAllocations` (core) caps what is applied to an invoice at what it is worth now, the latest allocations giving way first. What a return leaves paid beyond that is the customer's money again: it shows as their credit, can be refunded, or applied to another invoice, with no negative allocation and no edit. The integrity check and the zakat position use the same function, so the credit is counted once.
- **Profit.** `periodResultOf` walks each invoice's payments and returns in the order they were recorded. A return changes the invoice's worth and capital, so what its payments recognise changes; the difference is booked on the return's date as `returnsEffectCents` (signed), together with the change in the invoice's below-cost loss. It is a line of its own in the settlement (`returns_effect`) so the recognised profit stays what payments recognised.
- **Voids.** A sale with returns is not voided (`saleVoidIssues`): its void's reversals would put the same length back twice. The rest is returned instead.

The period lock covers `sale_return` by its date (`periodDatesOf`), not by its sale's.

### Supplier payables are two records and a derived balance

`purchase.paid_cents` is what was paid when the purchase was made (the database CHECK is now `0 ≤ paid ≤ total`; a debt needs a supplier). Later payments are `supplier_payment` records, created or voided and never edited, limited to what is owed (`checkSupplierPayment`). `supplierAccount` (core) derives the balance, the dues per purchase (a payment's target first, then the oldest) and the statement. Cash subtracts the payments; the integrity check adds the balance as a claim (`supplier_payables`, signed: an advance nets against the debts); the zakat base subtracts what is owed (`supplierDebts` in the report, defaulting to none for reports saved before).

### Roles are enforced where the data leaves the server

`CASHIER_ACCESS` (`@fabric/contracts`) says, for **every** synced entity, what a cashier is sent (all, redacted, none) and which ops it may push. It is typed `satisfies Record<SyncEntity, …>`, so a new entity cannot be added without deciding it. The server applies it in three places:

1. **The AuthGuard** admits a cashier only on routes marked `@CashierMayCall()` (the sync hub, device registration, its profile). Everything else is 403: default-deny, so a route that returns a cost is closed to a cashier until someone opens it on purpose.
2. **Pull** (`SyncService.pull`) asks the registry only for the entities the role may read and redacts the rest (`redactForRole`: a roll's cost becomes 0; a cashier gets three settings). The cursor moves past the rows that are cut out, or the device would ask for them forever.
3. **Push** (`SyncService.pushOne`) rejects an op the role may not push as `forbidden`, and a cashier's sale that confirms a sale under cost or a payment that is a refund (`cashierPushIssues`). The roll upsert is refused for a cashier on purpose: its redacted copy would overwrite the cost.

The device repeats the push check before saving (`LocalStore.setRole`, the outbox hook), so a refused change is never made at the counter. A cashier's device sees cost 0, so it cannot warn about a sale under cost; the server prices every sale with the real costs and rejects one under cost without the owner's confirmation (RL4). The screens hide cost, profit and the owner's pages with `useCanSeeCosts` and a role-filtered navigation; that is convenience, not the control.

## Consequences

- A return, a payment to a supplier and a cashier's sale all work offline and sync like any record; the server is the check.
- The shop's integrity check holds with returns and payables (property-tested over random histories: after every event, with partial returns, refunds, credit purchases and payments, across settlements).
- A settled month is unchanged by a later return; the next period carries the effect.
- A new synced entity must be added to `CASHIER_ACCESS`; a new REST route is closed to cashiers unless marked.
- Not built: a partner paying a supplier from their own pocket (SP5), a restocking fee, undoing a return (RT7), and role changes from the app.
