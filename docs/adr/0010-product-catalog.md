# ADR 0010: Product catalog and legacy inventory compatibility

## Context

The existing shop catalog identifies stock by `fabric → variant → roll`. The approved product
domain needs independent Product identities and explicit purchase/selling unit configuration,
including an optional kg-to-meter conversion. Purchases, sales, returns, photos and stock movements
still reference the legacy entities and must remain intact during this domain slice.

## Decision

- Add Product as a separate mutable, synchronized catalog entity. A Product has its own name,
  optional SKU and description, tags, purchase-unit set, selling-unit set, optional integer kg-to-
  meter relationship, and active state.
- The kg-to-meter relationship stores integer grams and centimeters plus whether it is estimated
  or measured. A missing relationship stays `null`; it does not imply a stock quantity.
- The migration creates exactly one Product for every legacy Variant, reusing the Variant UUID.
  The name is the parent Fabric name plus the Variant color. No stock, costs or transaction rows
  are combined or rewritten.
- Purchase units are the distinct methods found in that Variant's purchase history. A product
  with no purchase history has no inferred purchase unit. Existing fabric tags, notes, whole-piece
  capability and kg estimate are copied where their meanings are compatible; the estimate remains
  marked estimated.
- Legacy Fabric, Variant, Supplier, Photo, Purchase, Roll and StockMove entities remain in place.
  Existing purchase and sales workflows continue to use them until a separately approved
  transaction migration.
- Product writes use the existing local-first outbox, mutable last-write-wins sync and audit path.
  Product is visible to cashiers but cannot be changed by them.

## Consequences

- Old records and references remain available for reports, sales, returns, exports and recovery.
- The product catalog is ready for future product-based workflows, but this ADR does not change
  stock calculations or introduce awaiting-measurement purchase behavior.
- The Product migration is additive. Deploy the API and compatible web application together:
  older clients do not recognize newly added sync entity names.
