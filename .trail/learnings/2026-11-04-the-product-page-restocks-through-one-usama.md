---
title: 'The product page restocks through one shared purchase form, in a sticky side panel'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 26, tokens: 428173 }
id: l-8ecc23b7
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/zz-shots.spec.ts
  - apps/web/src/features/inventory/restock-form.tsx
  - CLAUDE.md
  - apps/web/src/features/pos/bill-panel.tsx
---

## Decided

- Adding stock to a product has ONE implementation: `useRestockForm` + `RestockFields` (draft, total, validation, duplicate-submit guard, renewal warning, `productInventory.restock`). The list's Add Stock dialog is a thin wrapper around it; the product page's Quick Add Stock panel is the same form in a bill-style layout (fields scroll, total + one accent button pinned at the bottom). A second copy of the purchase logic would drift from the SPEC §8.5 / PB19 rules.
- The product page owns the form state (not the panel), so a half-typed purchase survives the phone sheet closing and a window resize. The panel is mounted once: beside the page at >= 1024px (sticky under the 3.5rem header), otherwise a fixed bottom button opens it in a Drawer, the same pattern as the POS bill.
- Movements now carry where they came from: `reference` (purchase id, or the sale of a sale/return/reversal) and the person's `note`. Core's movement drops `refId` and `note`, so the device keeps an `origins` map from the stored moves; no accounting is recomputed in the UI. A purchase movement's cost is the batch's purchase cost, so the history can show value.
- Supplier names for the purchases behind the batches come with the detail view (`supplierOfPurchase`); a till's device has no suppliers table data, so it just shows none.
- The stock overview never shows selling or minimum prices; they sit in "Product details". Batches stay visible one by one with their own original cost, remaining value and received weight, because two batches of one product can cost differently.
- Weight bought without a length stays "awaiting measurement": it is counted apart from what can be sold, shows the Measure button on its batch, and nothing in the page makes a length from it.

## Tried and ruled out

- Keeping the header Add Stock button next to the panel: two gold primary actions on one screen (CLAUDE.md allows one) and two ways into the same form.
- Separate table and card renderings of batches/movements: one list markup that switches layout with container queries (`@2xl`) keeps one set of cells and works inside the narrow left column of the desktop layout.

## Watch out

- Playwright `restock()` now fills the panel on the product page (desktop-sized window), not a dialog; `submitRestock` waits for the quantity field to clear, which only happens after the local save finished. Navigating right after the click can abort the write.
- The history test needs more than 10 movements (the page shows the latest 10 first), so it buys 10 more batches; that is why it is the slowest spec of the file.

In the code: `apps/web/src/features/inventory/restock-form.tsx`, `quick-add-stock-panel.tsx`, `product-detail-screen.tsx`, `batch-list.tsx`, `movement-history.tsx`; `apps/web/src/local-db/product-inventory.ts` (`productMovements`, `detail`); `apps/web/e2e/product-workspace.spec.ts`, `e2e/helpers.ts`.
