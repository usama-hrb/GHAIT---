# ADR 0017: The settings workspace, the shop's identity and the display currency

Status: accepted. No accounting rule changed; no new row in `accounting-assumptions.md`.

## Context

Settings was one screen: a unit switch, the sync status, the issues list and the two downloads
stacked together. Partners had their own sidebar entry, although they are configuration (who owns
what), not a daily screen. The shop's name could be changed only through the generic settings API,
and the logo was a file in the build: every shop looked like "غيث".

## Decision

### Layout and routes

- Settings is a workspace with five sections, each its own route under one shared layout
  (`app/(shop)/settings/layout.tsx` → `SettingsShell`): `/settings` (business profile),
  `/settings/regional` (currency), `/settings/partners` and `/settings/partners/view?id=`,
  `/settings/sync`, `/settings/data`. The shell is a list at `lg` and scrollable tabs below, with a
  breadcrumb. Each section is a separate form, so general preferences and sensitive configuration
  are never one big form.
- **Partners moved, not copied.** `PartnersScreen` and `PartnerAccountScreen` (feature `partners`)
  and the `partner`, `capital_move`, `partner_draw` and settlement repositories are untouched: only
  their hrefs changed. The sidebar entry is gone. `/partners` and `/partners/view?id=` stay as
  client redirect pages (`RedirectTo`, the id is kept) and in the service worker's precache, so
  bookmarks and an installed older shell keep working (precedent: ADR 0012).
- **Cashiers** see the profile, currency, sync and data sections read-only, but not Partners:
  `/settings/partners*` is refused in `mayOpen` like the other owner/partner screens, and the API
  already refuses the data (ADR 0007).
- Known cost: the Ctrl+K page search is built from the sidebar, so it no longer lists Partners.

### Persistence of identity and currency

- `setting` stays a **pull-only synced entity: the server is the single source of truth**. A change
  is a call to the audited `PUT /settings/:key` (`ShopSettingsRepository.save`: validate with the
  setting's contracts schema, call the server, then `syncNow()` so the device sees it at once).
  Reading is from Dexie and works offline. Editing needs a connection and the owner role: the
  screens say so and disable their controls; what was typed is kept.
- Rejected: making `setting` a mutable, pushable entity (outbox + conflict rules). Two devices could
  then disagree about the shop's name or currency with no right answer, the audit trail would be
  written by the sync hub, and a value that every screen and every shared text reads would flip
  silently on a device that was offline. The price of the choice is that these few settings cannot
  be changed offline. They are changed rarely, by the owner, at a desk.
- No second source: the name is `shop_name`, the logo is `shop_logo`, the currency is
  `money_display_unit`. The frame reads them through `useShopIdentity()` and `useMoneyUnit()`.

### The logo

- `shop_logo` is a setting whose value is a `PhotoImage` or `null` (ADR 0009's schema: a JPEG, at
  most 250 KB as base64). The device makes it small with the same `compressImage` as product photos
  (480 px at most, at most 120 KB, JPEG on white), after a pre-check of the file (PNG, JPEG or WebP,
  at most 5 MB). A file that cannot be read or made small leaves the current logo untouched.
- Its bytes are kept out of the audit log and the CSV export (`settingAuditValue` →
  `[JPEG N bytes]`), counted in `syncWeightOf` so pushes and pulls are cut by size, and sent to
  cashiers (`CASHIER_SETTING_KEYS`) because the till shows the shop's mark. The full JSON export
  carries it, so a backup restores it.
- A shop's own logo shows on a white tile. The CLAUDE.md rule "the logo only on burgundy" is about
  the built-in brand mark, which still shows while no logo is set.

### Where identity shows

- `AppShell` takes a `brand` prop (`{name, logoSrc}` or `'loading'`). `shared` cannot import a
  feature, so the layout passes `useShopIdentity()` in. While the setting is read, a quiet
  placeholder holds the place so the built-in mark does not flash. The sign-out control now comes
  in the same way (a `signOut` slot), so `shared` no longer imports the sync feature: the shell's
  layer violation and the import cycles through it are gone (`make deps` reports none).
- Invoices and customer or supplier statements are shared as **text** (no printing, no PDF). They
  already read `shop_name`, so they follow the new name with no change. A text cannot carry a
  logo; the profile screen says so.
- Not dynamic, by nature: the PWA manifest and the static `<title>` (built at deploy time).

### Currency

- Every amount is stored and sent as whole cents whichever unit is displayed. `money_display_unit`
  only decides how an amount is typed and written (`<Money/>`, `<MoneyInput/>`, `formatMoney`,
  parsing). Switching therefore **converts no data**: nothing is rounded, re-saved or re-dated, so
  debts, payments, expenses, stock costs and settlements are exactly as they were. This is proven,
  not assumed:
  - `packages/core/src/money/money.test.ts`: for any integer cents, formatting in dirham and parsing
    back (and the same in rial) returns the same cents; a rial amount of half a rial is refused
    with `not_exact`, never rounded; exact examples for both units.
  - `apps/web/src/local-db/shop-settings.test.ts`: switching the unit leaves stored expense rows
    byte-identical, and amounts round-trip in both units.
  - `apps/web/e2e/settings.spec.ts`: the same sale reads 800 rial and then 40 dirham, and the
    server holds the same `totalCents` before, during and after.
- The choice is a draft until Save; the screen shows sample amounts in both units meanwhile, and
  states that nothing already saved changes. 1 dirham = 20 rial (SPEC §0).
- SPEC §0 describes a quick toggle in the UI. It is now the Currency section of Settings; the
  `MoneyUnitToggle` component stays in `shared/format` for the design gallery.

## Consequences

- Settings, identity and currency each have one writer (the owner, online, audited) and one reader
  per screen. A new setting that is edited from a screen follows the same `save` path.
- Partner records, balances, settlements and history did not move, so nothing needed migrating.
- The Dexie schema, the API tables and the sync protocol did not change; `shop_logo` is a new
  setting key with a default (`null`), which an old backup simply lacks.
- Offline editing of these settings is a known limitation, recorded here on purpose.
