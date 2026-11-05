---
title: 'Shop name, logo and currency are server-owned settings, edited online only'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 30, tokens: 582187 }
id: l-25ce2518
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/settings.spec.ts
  - docs/adr/0017-settings-workspace.md
  - apps/api/test/data.e2e-spec.ts
  - docs/design-usage.md
  - docs/DESIGN_SYSTEM.md
  - CLAUDE.md
  - apps/web/e2e/zz-settings-shots.spec.ts
  - packages/contracts/src/settings.ts
---

## Decided

- The business name (`shop_name`), the logo (`shop_logo`) and the currency (`money_display_unit`) stay pull-only synced settings. The owner writes them online through the audited `PUT /settings/:key`, then the device syncs; reads come from the device and work offline. Edit controls are disabled, with a notice, when offline or not the owner.
- Why not make `setting` a pushable entity: two devices could disagree about the shop's name or unit with no right answer, and every shared text reads them.
- The logo reuses the product-photo pipeline (`compressImage`, `photoImageSchema`); its bytes are masked in the audit log and CSV, counted in `syncWeightOf`, and sent to cashiers.
- Switching rial/dirham converts nothing: amounts are always cents. Proven by core property tests, a local-db test and an e2e that reads the server's `totalCents` before and after.
- Partners moved under Settings; `/partners` stays as a client redirect page (the `?id=` is kept).

## Tried and ruled out

- A second, independent identity source (a separate profile table): two places to keep in step; WhatsApp texts already read `shop_name`.

## Watch out

- `local-db/tables.ts` must not import `settlements.ts` (cycle): the settings repository lives in `shop-settings.ts`.
- e2e specs that change settings must put them back (`afterEach` with `serverPut`): the server is shared between specs.
- In `ar.ts` (`as const`) arrays become readonly tuples and no longer match `en.ts`: use keyed objects.

In the code: `apps/web/src/local-db/shop-settings.ts`, `apps/web/src/features/settings/`, `docs/adr/0017-settings-workspace.md`.
