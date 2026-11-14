# Design system: how to use it

How to build screens with the غيث design system. The _why_ (brand, colours, layout) is in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this page is the _how_. Open the live gallery while you work: `pnpm --filter @fabric/web dev`, then http://localhost:3000/design.

## Where things live

| What                                                       | Path                             | Import                              |
| ---------------------------------------------------------- | -------------------------------- | ----------------------------------- |
| Tokens (brand-tokens.css, verbatim)                        | `apps/web/src/app/globals.css`   | —                                   |
| shadcn/ui components (vendored)                            | `apps/web/src/shared/ui/`        | `@/shared/ui/button`                |
| Brand: Logo, DiamondBullet, AppShell, states, connectivity | `apps/web/src/shared/brand/`     | `@/shared/brand`                    |
| Money, Meters, DateText, MoneyInput, MeterInput            | `apps/web/src/shared/format/`    | `@/shared/format`                   |
| Theme provider and toggle                                  | `apps/web/src/shared/theme/`     | `@/shared/theme`                    |
| User-facing strings                                        | `apps/web/src/i18n/ar.ts`        | `import { messages } from '@/i18n'` |
| Shop navigation (sidebar and tabs)                         | `apps/web/src/app/navigation.ts` | —                                   |
| App-wide providers                                         | `apps/web/src/app/providers.tsx` | —                                   |
| Brand images, PWA icons                                    | `apps/web/public/brand/`         | `/brand/…`                          |
| Dev-only gallery                                           | `apps/web/src/app/(dev)/design/` | —                                   |

## Rules (lint enforced in `features/` and `shared/`)

- **Logical direction only.** `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/rounded-e…`, never `ml-/mr-/pl-/pr-/left-/right-/text-left/text-right`. The rule `design-system/no-physical-direction-classes` suggests the logical class. An explicit `rtl:`/`ltr:` variant is allowed when you really mean one direction.
- **Tokens only.** No hex/rgb/hsl/oklch literals and no Tailwind palette colours (`bg-red-500`). Use semantic tokens (`bg-primary`, `text-muted-foreground`, `text-profit`, `bg-success`…). Raw brand scales (`bg-burgundy-800`, `text-gold-800`) are for brand surfaces only. Rule: `design-system/no-raw-colors`.
- **Text through i18n.** No Arabic (or any user-facing text) in components. Add the string to `ar.ts`; plurals use `plural(count, forms)` (Arabic has zero/one/two/few/many/other).
- **Numbers through `shared/format`.** Never format money, lengths or dates by hand on a page.
- **Colour never carries meaning alone.** A tone (`text-loss`, `variant="warning"`) always comes with a word or an icon.
- **One gold (`accent`) button per screen**: the main action ("إتمام البيع"). Regular buttons are burgundy (`default`), secondary is cream, dangerous is red (`destructive`).
- **Gold as text:** `text-gold-800` on light surfaces only; gold (`text-gold-500`, `text-accent`) as text only on burgundy or dark surfaces.
- **The logo only appears on burgundy.** `<Logo>` brings its own burgundy frame, so it is safe anywhere; don't use the PNGs directly.
- **Every screen has four states:** loading (`LoadingState`), empty (`EmptyState`), error (`ErrorState`), offline (`ConnectivityStatus` in the header, plus the screen's own offline behaviour).

The rules live in [packages/config-eslint/design-system.js](../packages/config-eslint/design-system.js) and are unit-tested next to it.

## Tokens

`globals.css` contains `brand-tokens.css` from `brand-assets.zip` verbatim, between `>>> brand-tokens.css` and `<<< end brand-tokens.css`. After that block come app additions that introduce no colour: the `font-heading` utility and the default `border-color`.

- Change a token only with the owner's approval. The owner approved five changes on 2026-11-13 so that every pair passes (listed in the comment at the top of the brand block of `globals.css`): light `--muted-foreground` `#6f6864`, light `--warning` `#976217` (and so `--debt`), light `--input` `#8e8a84`, dark `--input` `#756e6e`, and a dark `--estimated` of `var(--gold-500)`. The brand file itself was not changed; these are the app's values. [apps/web/src/app/tokens.contrast.test.ts](../apps/web/src/app/tokens.contrast.test.ts) checks every semantic pair in both themes: text ≥ 4.5:1, input borders and focus ring ≥ 3:1. Never lower a threshold; fix the token, with approval.
- Dark mode is the `dark` class on `<html>` (next-themes, default `system`). `dark:` variants work; prefer tokens, which switch by themselves.
- Radius: `--radius` is 8px; use `rounded-md` for fields, `rounded-lg` for cards and `rounded-xl` for dialogs.
- Figures: `data-num` (or `.num`) gives tabular, lining digits. The format components set it for you.

## Fonts

Loaded with `next/font/google` in `src/app/layout.tsx`:

- **Noto Kufi Arabic** → `--font-heading`, used through `font-heading` (or the tokens' `font-display`). Headings `h1`–`h4`, card, dialog, sheet and drawer titles.
- **IBM Plex Sans Arabic** → `--font-body`, the default `font-sans`.

Inputs are 16px (no iOS zoom). On touch screens (`pointer-coarse`), buttons and fields grow to 44–48px.

## Components (`src/shared/ui`)

These are shadcn/ui (style `radix-nova`, Radix primitives, Lucide icons), vendored and owned by us. Local changes:

- `Button` adds `variant="accent"` (gold) and `pointer-coarse` touch sizes. `Badge` adds `success` and `warning`.
- `Input`/`Textarea` are 16px at every width; `Input`, `InputGroup` and `SelectTrigger` are 44px on touch screens.
- `Combobox` is our own Command + Popover (Radix only; shadcn's Base UI combobox is not used).
- `CommandDialog` puts what it is given inside a `Command` root, so a caller passes only the parts (`CommandInput`, `CommandList`, `CommandEmpty`, …). cmdk's parts throw when they render outside a root; the radix-nova template leaves the root to the caller, and the sidebar's page search crashed the whole shop screen the first time it was opened because it did not add one. It also hands the keyboard back to whatever had it when it opened, because Radix returns focus only to a trigger button and this dialog is opened by state, with none. Keep both changes when the primitive is vendored again.
- Forms use `Field` (shadcn replaced `form` with `field`) + react-hook-form + zod. Pattern: label above, error below with an icon (see the gallery's sale-line form).
- Sheet and Sidebar position by a _physical_ `side` prop, so their side classes are physical (with a lint exception). The app sidebar is `side="right"`.
- English screen-reader strings ("Close", "Toggle Sidebar"…) are replaced with `messages.ui.*`.
- `Calendar` follows the language: `ar-MA` and RTL in Arabic, `en-GB` and LTR in English.

To add a component, run from `apps/web`: `pnpm dlx shadcn@4.23.0 add <name>`. Then run `pnpm prettier --write src/shared/ui`, replace any English labels with i18n strings, add `font-heading` to its title if it has one (the CLI strips it in this project), and run `make check`. The design-system lint will flag any physical class or raw colour it brings. Some type-aware rules are relaxed for `src/shared/ui` only, to keep it close to upstream (see `packages/config-eslint/next.js`).

## Brand (`@/shared/brand`)

```tsx
<AppShell
  nav={shopNavigation()} // src/app/navigation.ts (a function: labels follow the language); `group` sets the dashed-line groups, `groupLabel` the heading above a group, `parent` puts a page under another (one level), `tab: true` = phone tab
  account={{ name: user.displayName, detail: roleLabel }} // the card at the top of the sidebar
  title={messages.nav.pos}
  onSearch={() => setSearchOpen(true)} // also Ctrl+K / ⌘K
  status={<ConnectivityStatus pendingCount={outboxSize} />}
  actions={
    <>
      <LanguageToggle />
      <ThemeToggle />
    </>
  }
>
  {content}
</AppShell>
```

- Desktop: a **light sidebar** at the start (right in Arabic, left in English; `useDirection()`): the account card (the logo mark and who is signed in), a page search (field with `Ctrl K`; `NavPalette`), the pages in groups set apart by dashed lines, each group under a small heading (Main, Operations, Finance, Administration; the Reports group has none, because its first item says what it is), a page that names a `parent` drawn indented below it (Financial Integrity under Reports; `nestNav` allows one level and keeps a page at the top level when its parent is not in the role's list), the active page a burgundy pill with the gold diamond (its parent is darker, not a pill, while a page under it is open), a soft background on hover. The header's collapse button folds it to a rail of **large icons** (24 px in 44 px squares) without the names or the headings, the nested page's icon in line with its parent's; a tooltip names each icon. See [ADR 0027](adr/0027-financial-integrity-screen-and-grouped-navigation.md). The panel reads the page's tokens through the `.shop-sidebar` scope in `globals.css` (the brand file's burgundy sidebar tokens are untouched); the pill uses the brand's `sidebar-accent` pair. Phone: 4 tabs plus "More" (`messages.nav.more`), a drawer with the rest in the same groups and with the same nesting.
- `Logo` (`variant="full" | "mark"`): size it with `w-*` or `h-*`.
- `DiamondBullet`: decorative, sized by font size (`text-xs`).
- `EmptyState`, `ErrorState` (`onRetry`), `LoadingState` (`variant="skeleton" | "spinner"`). Pass `titleAs="h3"` when nested under an `h2`.
- `NotFoundScreen`: the page for an address that matches no screen (`app/not-found.tsx`; Next answers it with status 404). It stands alone, with no sidebar and nothing read from the device's database, so it opens the same signed in, signed out or offline. Language and theme can be changed on it, and its one gold action leads to `/home`, which sends a signed-out visitor on to the sign-in page. The description is in the foreground colour at 80%, not the muted token, whose contrast on the page is just under AA.

## Format (`@/shared/format`)

```tsx
<Money cents={line.totalCents} />                 // "410 ريال" or "20.50 د" (setting)
<Money cents={profitCents} tone="profit" />       // tones: profit | loss | debt | capital | estimated
<Meters cm={275} />                               // "2.75 م"
<DateText value={sale.date} format="long" />        // "29 أكتوبر 2026", Africa/Casablanca
<MoneyInput value={cents} onValueChange={setCents} required />
<MeterInput value={cm} onValueChange={setCm} />
<MoneyInput large keypad text={pad.texts.price} onTextChange={(t) => pad.type('price', t)} value={cents} />
<Keypad onPress={pad.press} />
```

- Everything goes through `@fabric/core` (`formatMoneyAmount`, `parseMoneyInput`, `formatLengthMeters`, `parseLengthInput`); no number logic lives in web.
- Plain text (WhatsApp invoice, toasts, CSV): use core's `formatMoney(cents, unit)` → "410 ريال" and `formatLength(cm)` → "2.75 م". They join number and unit with a no-break space and put an LRM before a minus sign, so "-410" doesn't flip in Arabic text. Components keep rendering digits (in `<bdi>`) and label separately.
- Display unit: `MoneyUnitProvider` holds the `money_display_unit` setting (rial by default). The owner picks it in Settings › Currency (a draft until saved; the screen previews sample amounts in both units); `MoneyUnitToggle` stays for the design gallery. Switching converts no data: amounts are always whole cents ([ADR 0017](adr/0017-settings-workspace.md)).
- Inputs accept Arabic-Indic and Persian digits and `.`/`٫`/`,` as the decimal point, use `inputmode="decimal"` and return integer cents/cm, or `null` while empty or invalid. Thousands separators are rejected.
- Rial input must be a whole number of cents: half a rial (2.5 cents) is rejected with a message, never rounded (SPEC §0.2).
- Errors show after the first blur; pass `showError` to show them after a submit attempt.
- **Keypad (tablet and desktop till; none on a phone).** `Keypad` is a 3×4 pad of keys (digits, decimal point, delete). A phone (under 640 px wide, or under 500 px tall) renders no keypad and types with its own keyboard: the selling dialog reads `useMediaQuery(PHONE)` and passes `keypad={false}`, which gives the fields `inputMode="decimal"` (`CountInput`: `numeric`) ([ADR 0026](adr/0026-selling-dialog-sized-by-content-phone-keyboard.md)). `usePadFields` keeps the typed text of the fields one pad serves and which of them it types into; `pressKey` is the pure rule (one decimal point, no leading zero, `moneyPad(unit)`: one decimal for rial, two for dirham, `LENGTH_PAD`: two). `MoneyInput`/`MeterInput` take the text from the parent with `text`/`onTextChange`, `keypad` (inputMode none: no system keyboard, a physical one still types) and `large` (a big figure). A key never takes the focus from the field, so the first digit after a field is chosen or filled by a quick button replaces what it holds. The pad only builds text; cents and cm come from the core parse helpers.

## Photos of colours (`ProductPhoto`, `PhotoField`)

A colour has an optional picture ([ADR 0009](adr/0009-product-photos.md)), set by the owner in the colour's dialog on the fabric page.

- **Show** one with `<ProductPhoto src={photos.get(variantId)} className="size-12 rounded-md" />` (`@/shared/brand`): the picture from its `data:` URL, or a quiet placeholder. It is decorative (`alt=""`): the colour's name is always written beside it. Get the sources with `useLiveQuery(() => repositories.photos.sources(), [repositories])`, a map by variant id of each colour's newest live photo.
- **Set** one with `<PhotoField>` (`features/catalog`): a button to choose a file, one to take a photo on a touch device, one to remove it. It hands the picked `File` up; the caller makes it small with `compressImage` (`@/shared/lib/image`: 480 px, JPEG, at most ~120 KB, on white) and saves it with the colour (`repositories.photos.set(variantId, image)` / `.remove(variantId)`). The photo is saved on the device first and syncs later like any record.
- **Shown** on the POS tiles (a 4:3 picture over the name), the bill's lines and the line dialog, the colours' list, and the stock screens.
- **Test image:** `apps/web/public/brand/product_1.jpeg` (2048 × 2048, 2.2 MB) is what `e2e/photos.spec.ts` uploads.

## The POS (`features/pos`, for a touch tablet)

- **Layout.** From `lg` (1024px) the catalog (search, a chip per fabric, a tile per colour that has cloth left) sits beside the bill (24rem): each scrolls on its own and the bill's Pay button stays at its foot. Below `lg` the bill is a drawer behind a gold bar at the bottom ("Invoice · 3 items · total"). On a tablet narrower than 1280px the main menu folds to its icons while selling and reopens afterwards.
- **Flow.** Tap a tile → the line dialog, as tall as its content: length and price typed on the keypad beside the fields (on a phone: with the phone's keyboard, no keypad), quick lengths (the ones the stock covers) and quick prices (normal, minimum), the batch and the batches taken, the line's total (no profit: the selling screens show none) → "Add to the invoice". Tap a line of the bill to change it; tap Pay → the payment dialog: paid in full, or credit/part payment (a customer is required; amount on the keypad; quick Nothing/Half/All; due date). A sale under cost asks for its confirmation there. "Half" is half the total rounded down to a whole rial: a suggestion to edit, not a rule.
- **Rules kept.** The bill is priced by `repositories.sales.preview` (core), the checkout prices it again with the payment; the sale is saved on the device first and offline works. A cashier never sees a cost or a profit.
- **Tests.** `e2e/pos.spec.ts` drives the dialogs with `fill`; `e2e/pos-keypad.spec.ts` taps the keypad on a 1024×768 touch tablet. `e2e/line-dialog.spec.ts` measures the selling dialog on a desktop, both tablet orientations and four phone widths (no keypad on a phone, real key presses, the two owner confirmations, the keyboard up).

## Languages (`@/i18n`, `@/shared/language`)

English is the default, Arabic the other language ([ADR 0008](adr/0008-languages.md)). Each device keeps its own choice.

- **A new text** goes into `src/i18n/ar.ts` **and** `src/i18n/en.ts` under the same key (the type of `ar.ts` is the shape of `en.ts`, so the compiler refuses a missing or extra key; `catalogs.test.ts` also checks function arity and that no Arabic leaks into English). Counted nouns use `plural(count, { zero, one, two, few, many, other })` with only the forms the language has.
- **Reading texts:** `messages.x.y` where it is shown. `messages` is a live view of the catalog of the language shown, so `const t = messages.pos` at the top of a file stays correct, but `const LABEL = messages.pos.title` copies one string for good: build such lists inside a function or a component (see `shopNavigation()`, `ThemeToggle`).
- **Switching:** `<LanguageToggle />` (icon + list, in the shop header and on the login page). `useLanguage()` gives `{ language, dir, locale, setLanguage }`. `LanguageBoundary` (in `AppProviders`) remounts the screens on a change, below the database and session providers, so those do not reload.
- **Direction:** the page's `lang`/`dir` follow the language, so logical classes just work. Where code must pick a physical side (sidebar `side`, chart axes, toasts), read `useDirection()`.
- **Dates:** `<DateText>` / `formatDate(value, format, language?)` use the language shown (`en-GB`, `ar-MA`), always Gregorian with Western digits; `format="hijri"` is for zakat only.
- **Plain text** (invoice, statement): pass the language to core, `formatMoney(cents, unit, getLanguage())`, so the units read "dh"/"rial"/"m" in English and "د"/"ريال"/"م" in Arabic.
- **Fonts:** English text and headings use IBM Plex Sans (`--font-body-en`, applied by `html[lang='en']` in `globals.css`); Arabic keeps IBM Plex Sans Arabic and Noto Kufi Arabic.
- **Not translated:** names and notes the user typed, the shop name setting, the dev-only `/design` gallery (`ar.design.ts`). The shipped expense categories are stored with Arabic labels, so `categoryName()` shows them by key in the language shown; a category the owner renamed or added keeps their name.
- **Tests:** the web unit tests start in Arabic (`src/test-setup.ts`); a test about English calls `setLanguage('en', { persist: false })`. In e2e, `signIn()` opens the page in Arabic (`setDeviceLanguage`); `language.spec.ts` covers the default and the switch.

## Gallery (`/design`)

`src/app/(dev)/design/page.dev.tsx` and `shell/page.dev.tsx` are routes only under `next dev` (`pageExtensions` in `next.config.ts`). A production build has no `/design` and does not bundle its copy (`src/i18n/ar.design.ts`). It renders every token, component, brand piece and format, plus RTL checks: flipped directional icons, logical spacing, alignment and mixed text. It also embeds `/design/shell` at desktop and phone sizes. Switch theme, language and money unit from its header (its own copy is Arabic only: switch to Arabic to see the RTL checks as designed).

## Checking accessibility

1. `make check` runs the contrast test with the other tests.
2. Lighthouse on the gallery (target ≥ 95; currently 100 light and dark, phone and desktop):
   ```sh
   pnpm --filter @fabric/web dev
   CHROME_PATH=/usr/bin/google-chrome pnpm dlx lighthouse@13.6.0 http://localhost:3000/design \
     --only-categories=accessibility --chrome-flags="--headless=new"            # add --preset=desktop
   # dark: --chrome-flags="--headless=new --force-dark-mode"
   ```
3. Look at it at 375px and 1280px in both themes; no horizontal scroll.

## PWA

`src/app/manifest.ts`: name/short_name from the default language (Ghaith), `dir: ltr`, `lang: en`, `display: standalone`, theme and background `#491017`, icons from `/brand` (192, 512 and maskable 512). Favicon and Apple icon are `src/app/icon.png` and `apple-icon.png`. The service worker and offline caching arrive with BUILD_PROMPTS 3.1.
