# ADR 0012: Product batches are the only stock

Status: accepted (owner's decision "A", 2026-11-03). Supersedes [ADR 0011](0011-product-stock-bridge.md).

## Context

Stock lived on rolls of a colour of a fabric (`fabric`, `variant`, `roll`, `stock_move`). ADR 0010
added Product and ADR 0011 read rolls as product batches without writing to them. The owner asked
to stop there: product batches become the single source of truth for inventory, the old model is
not hidden behind the new screens, and history, balances and accounting stay exact.

## Decision

- A **batch** (`product_batch`) is one purchase lot of one product, in the unit it was received
  (kg, meter or piece). Its moves are `product_stock_move` (append-only). Remaining quantity, cost,
  cost per unit, weight awaiting measurement and oversold are derived from the moves by
  `productStockBatchLedger` and `productStockLedger` in `@fabric/core`; nothing is stored.
- Everything writes batches: Add Product (with its first stock, one transaction), Add Stock
  (restock, a batch of its own), measurement, loss, count, sale, return, void. Sale lines point at
  a batch with a unit and a quantity (cm or pieces). Locked costs (P9) point at batch moves.
- The old tables stay as **history**, never written again: they are pull-only sync entities, and a
  cashier receives none of them. Nothing is dropped; dropping is a later "contract" migration, after
  the owner has run on batches for a while.
- Ids carry over, so history keeps its links: batch id = roll id, move id = old stock move id,
  product id = variant id, `sale_line.batch_id` = its roll id.
- The Inventory screen is the product list; `/purchases/new`, `/purchases`, `/inventory/catalog`
  and the fabric, colour and roll pages redirect to it (on the client, so the offline shell works).
  `/purchases/view` stays to show a purchase and its batches.

### Minimum selling price

- A product has a normal and a minimum price per selling unit. A **cashier never sells below the
  minimum**: the line cannot be added, the device refuses it (`priceSale`) and the server rejects
  it, with the product as the server has it, not the device's copy.
- The **owner** may, after an explicit confirmation in the line dialog. The line then carries
  `min_override_by` (the owner's username); the applied price is on the line, and the server writes
  an `audit_log` entry (`sale_line`, "sold under the minimum price"). The server accepts only the
  signed-in owner's own username there; a cashier's push carrying an override is rejected.
- This is separate from the existing under-cost rule (`confirmed_below_cost`, asked at payment).
  A line can need both; one does not confirm the other.

## Migrations and their risk

Expand now, contract later: columns are added or relaxed, never renamed or dropped.

- **0028** new tables and guards. Nothing existing is touched.
- **0029** copies rolls, moves and prices into batches and products. It only reads the old tables,
  runs in one transaction and ends with a reconciliation that aborts it on any difference (rolls
  without a batch, batches without a purchase receipt, a cost or a remaining length that differs).
  `test/product-stock-backfill.e2e-spec.ts` re-runs the SQL between its `backfill:` markers on
  seeded legacy data, the same SQL `make import` runs for an old export.
- **0030** gives `sale_line` its batch, unit, quantity and override columns. `sale_line` is
  append-only, so the one backfill statement switches its update guard off **inside the
  migration's transaction**, then checks the guard is back; a failure rolls everything back. A
  reconciliation aborts it unless every line and frozen cost kept its facts.
  `test/sale-lines-backfill.e2e-spec.ts` covers it.

Before deploying: `make backup` and `make backup-verify` (runbooks/deploy.md).

## Offline

- Dexie v14 upgrades a device **in place**: rolls become batches, old moves become batch moves,
  sale lines and photos are rewritten, and **pending outbox ops are rewritten** (a queued roll
  purchase becomes a `purchase` op with its batches). A queued edit of a fabric or colour can no
  longer be pushed: it stays in the outbox, refused. A device that never synced the new data keeps
  working and syncs it later.
- `purchase` is one `append` op: `{purchase, batches, moves}`; `sale` is `{sale, lines, moves,
payment, allocation}`. Builders live in `@fabric/contracts`; the server re-runs them to check.
- A stale offline sale below a minimum the owner raised meanwhile is rejected by the server and
  shows in the sync issues (the owner decides). See assumption PB15.

## Consequences

- Product gets the weight-to-length ratio `est_cm_per_kg` used to have; measuring a weight batch
  updates it (C11), and Add Stock keeps the renewal-cost warning (SPEC §8.5).
- Reports, zakat, settlements and integrity read the product ledger. It keeps sale and loss costs
  gross and returns apart; `netCostsOf` gives the net the roll ledger had, so every figure is the
  same as before (the SPEC §16 tests T1–T16 are unchanged).
- Legacy code (`inventory.ts` roll helpers in contracts, legacy handlers in the API) stays until
  the contract migration.
