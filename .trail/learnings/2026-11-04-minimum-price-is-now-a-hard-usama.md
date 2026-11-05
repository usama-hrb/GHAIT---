---
title: 'Minimum price is now a hard limit, enforced by the server, with owner override'
author: Usama
date: 2026-11-04
standing: true
id: l-b8076e9a
scope: repo
status: active
src: init-sessions
touches:
  - 'packages/core/src/pricing/index.ts#isBelowMinimum'
---

## Decided

- It used to be only a warning, and the server had no minimum of its own because the POS copied it onto each sale line. Making it a floor changed the Sales validation rule, so the user approved it first.
- In the code: Server must read minimum price from its own product record, not from the sale line. Cashier is blocked below minimum. Owner can override after confirmation, recorded on the sale and in the audit log. Keep it separate from the under-cost confirmation (P8). Core has `isBelowMinimum` in pricing.

_From past Claude sessions here, Nov 3._
