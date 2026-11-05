---
title: 'Inventory lists products as photo tiles like the till, with the table kept as an opt-in view'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 18, tokens: 117575 }
id: l-14f2b68b
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/helpers.ts
  - apps/web/src/features/pos/pos-screen.tsx
  - apps/web/src/features/pos/catalog-panel.tsx
  - apps/web/src/features/inventory/stock-badges.tsx
---

## Decided

- The Inventory opens as photo tiles (same grid and card look as the Sell screen) and offers the dense table as a Cards/Table toggle on desktop. The choice is a per-device preference, not synced. Reason: a first restyle that only touched the table's borders and stat tiles looked unchanged to the owner; the visible gap to the till was structure (full width, photo-first tiles), not colours.
- On a phone the list is always tiles folded into photo-left rows; the table never shows there.
- The e2e `signIn` helper pre-sets the table view, so the specs that read rows and column heads keep their selectors; one new spec covers the toggle.

## Tried and ruled out

- Restyling only the existing table and stat box: passes every test but changes little to the eye. Passing tests do not show a visual change; look at the rendered page.

## Watch out

- In the code: `apps/web/src/features/inventory/product-inventory-screen.tsx`, `inventory-view.ts` (localStorage key `fabric.inventoryView`, read with useSyncExternalStore so the server render stays on tiles), `apps/web/e2e/helpers.ts`. The screen is full width; do not put back a `max-w` column.
