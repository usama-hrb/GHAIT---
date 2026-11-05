# ADR 0011: Product stock as a read bridge over the legacy rolls

Status: **superseded by [ADR 0012](0012-product-batches-single-stock-source.md)**. Batches are written
now; the bridge and its "nothing is stored" rule are gone. Kept as the record of how the mapping
was first proved against the roll ledger.

## Context

ADR 0010 added Product, and `@fabric/core` has a product stock ledger (one batch per purchase,
kg-to-meter conversion, weight awaiting measurement, oldest-purchase-first, returns, counts).
Nothing wrote to it: purchases, sales, returns, voids, write-offs and measurements still record
rolls and `stock_move` rows, and sales are priced and costed on those. Moving the writers to
batches touches sales, accounting, sync and history in one go, and the Purchases and Sales
modules are not part of this slice.

## Decision

- The legacy rolls and `stock_move` stay the only place stock is written. There is no new table,
  sync entity or second copy of any quantity.
- A roll is _read_ as a batch of its product by `legacyRollAsProductBatch` (`@fabric/contracts`);
  the figures come from `productStockBatchLedger` and `productStockLedger` (`@fabric/core`).
  The product of a roll is its colour (a migrated Product reuses its Variant's id); the batch
  reuses the roll's id.
  - bought by the metre, or a ready piece: a **meter** batch of its length (owner: a ready piece
    stays cut by the metre, or sold whole as all of its remaining length, PB6);
  - bought by weight: a **kg** batch of the weight bought, converting at the roll's length,
    `estimated`; each legacy measurement becomes a `measurement` of the whole length;
  - without the purchase (a cashier's device has none): a meter batch, which gives the same
    meters at no cost.
- The device computes the view (`ProductInventoryRepository`); React only displays it. A roll the
  ledger cannot read is listed and left out of the totals.
- The screens are product screens, not fabric and colour screens:
  - `/inventory`: search by name or code, filters (in stock, low, out, awaiting measurement), a
    one-line overview, and the products with what each can sell, where it is sold and its status;
  - `/inventory/product?id=`: the product, its stock, the weight waiting for a length, its batches
    (with cost for those who may see costs) and its movement history;
  - "New product" and "Edit" write the Product record through `ProductsRepository` (the owner
    only; the till and the partner read).
- The fabric and colour overview (with its rolls, fabrics, suppliers and purchases) stays at
  `/inventory/catalog`, because purchases and sales are still made on colours and rolls.
- A product's status: **out** only when nothing can be sold and no weight waits for a length;
  weight with no length is **awaiting measurement**, never out. **Low** is at or under the colour's
  low-stock threshold (a Product has none of its own yet, so a product that is a colour uses that
  colour's, and any other is never low, PB11).
- The bridge is held to the roll ledger by tests: remaining length, each sale's and loss's cost,
  what returns put back, cost left on the batch and cost per metre match `rollLedger` on
  generated histories of metre, piece and kg rolls (sales, losses, counts, returns, voids,
  measurements). That found two places where the new ledger drifted from the roll rule; it now
  follows it (PB8).
- Product selling units are meter and piece (migration 0027). Weight is a way of buying.

## Consequences

- Nothing in sales, purchasing, accounting or sync changes. Old records and devices keep
  working; the only schema change is a CHECK on `product.selling_units`.
- Weight awaiting measurement cannot appear from legacy data (a legacy kg purchase still asks
  for an estimated length). It appears with the Purchases slice, which will write batches; the
  mapping above is then the one-time backfill and the tests are its proof. The screens already
  show that state (a status, a filter, the weight and a note), and no measure action exists for
  it because no operation can record one yet. A batch whose length is only an estimate links to
  its roll, where the existing measurement is recorded.
- "New product" creates a catalog record only: purchases and sales are still made on colours, so a
  new product has no stock and cannot be bought or sold until the Purchases and Sales slices.
  Photos belong to colours (`photo.variant_id` references `variant`), so only a product that is a
  colour has one.
- Settlement-frozen costs (P9) are not in the product ledger yet. The screen shows no stock
  value at cost for that reason; they must be added before sales move to batches.
- A colour created after migration 0026 has no Product record. It is listed as "no product
  record" under the name the migration would give it. The slice that moves purchases must create
  the Product with the colour, or retire colours.
- A Product's `purchase_units` (0026) lists `piece` for ready-piece purchases; their batches are
  meter batches. The list is configuration and does not affect the bridge.
- Product "available" nets a batch sold beyond its length against the others (PB10).
