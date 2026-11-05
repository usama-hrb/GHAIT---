---
title: Never invent a fabric length from weight; keep weight stock awaiting measurement
author: Usama
date: 2026-11-04
standing: true
id: l-98b1bdc4
scope: repo
status: active
src: init-sessions
touches:
  - 'apps/web/src/local-db/product-inventory.ts#summarizeProductStock'
  - 'packages/core/src/costing/stock.ts#costBasisLength'
---

## Decided

- The old model turned a kg purchase into a guessed length and re-costed sales when measured. The new rule forbids inventing lengths, so weight batches stay pending until someone measures them.
- In the code: Do not compute length as weight × estCmPerKg. Use core `costBasisLength` / `lengthBasisCm` and `summarizeProductStock` for pending weight. Measuring a weight batch feeds the product's usual weight-to-length ratio, as the old fabric flow did.

_From past Claude sessions here, Nov 3._
