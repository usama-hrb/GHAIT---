---
title: Any change to costing must reproduce old period-locked history exactly
author: Usama
date: 2026-11-04
standing: true
id: l-719a307e
scope: repo
status: active
src: init-sessions
touches:
  - 'packages/contracts/src/inventory.ts#rollLedgerOf'
  - 'packages/contracts/src/stock.ts#netCostsOf'
---

## Watch out

- Closed periods have frozen costs. The cut-over had to match the old roll ledger, so a parity harness compared random histories against it, frozen costs included.
- In the code: Keep the parity tests in packages/contracts (seeded PRNG, no fast-check). Compare new product ledger against legacy `rollLedgerOf`, including frozen costs. Re-run them after touching cost logic. Product ledger keeps gross costs and returns apart. Use `netCostsOf` where the net figure is needed.

_From past Claude sessions here, Nov 3._
