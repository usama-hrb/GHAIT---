---
title: The restock history e2e test sometimes loses a click because the success toast covers the Quick Add button
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 0 }
id: l-717dcce0
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/product-workspace.spec.ts
  - apps/web/e2e/helpers.ts
  - apps/web/src/app/providers.tsx
  - apps/web/src/features/inventory/quick-add-stock-panel.tsx
---

## Decided

- Treat `product-workspace.spec.ts` "the history shows the latest movements first and the whole of it on request" as an intermittent test-side race, not a regression of the settlement, partner or salary work. It failed once in two complete e2e runs, always at the second to tenth restock, and passed on the rerun.
- Cause, shown with a probe: after each save, Sonner puts the success toast at the end-side bottom corner (bottom-left in Arabic), and the Quick Add panel's gold save button sits in the same corner. With the toast up, `document.elementFromPoint` at the button's centre returns the toast, and a click there submits nothing: no saving state, no error, the quantity field keeps its value. The `submitRestock` helper then waits 15 s for the field to clear and fails.
- Most iterations pass because Playwright waits for the toast to clear before the next click (about 3 s each). The failure happens when the next click lands while the toast is still sliding in.

## Tried and ruled out

- Blaming sync, the period lock or the local save: the API timeline and the Dexie write in the failing trace show iteration 1 saved normally and iteration 2 never reached `productInventory.restock`.
- Retrying inside the spec to hide it: not done. Two honest fixes exist, both outside the scope of the verification that found this: in the test, wait for the previous toast to be hidden before clicking again (or submit with Enter); in the app, move the toast away from the panel's button or give it `pointer-events: none`, which is a UX choice for the owner.

## Watch out

- A raw mouse click that rests on the toast also pauses Sonner's dismiss timer (hover), so a probe that clicks on it will see the toast stay up.
- To run one Playwright spec use `pnpm --filter @fabric/web exec playwright test e2e/<file>`. `pnpm --filter @fabric/web test:e2e -- e2e/<file>` silently runs all 64 tests, because the `--` swallows the filter.

In the code: `apps/web/e2e/product-workspace.spec.ts` (history test, 10 restocks), `apps/web/e2e/helpers.ts` (`submitRestock`), `apps/web/src/app/providers.tsx` (`AppToaster` position), `apps/web/src/features/inventory/quick-add-stock-panel.tsx`.
