# Design system: how to use it

How to build screens with the غيث design system. The _why_ (brand, colours, layout) is in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md); this page is the _how_. Open the live gallery while you work: `pnpm --filter @fabric/web dev`, then http://localhost:3000/design.

## Where things live

| What                                                       | Path                             | Import                              |
| ---------------------------------------------------------- | -------------------------------- | ----------------------------------- |
| Tokens (brand-tokens.css, verbatim)                        | `apps/web/src/app/globals.css`   | —                                   |
| shadcn/ui components (vendored)                            | `apps/web/src/shared/ui/`        | `@/shared/ui/button`                |
| Brand: Logo, DiamondBullet, AppShell, states, connectivity | `apps/web/src/shared/brand/`     | `@/shared/brand`                    |
| Money, Meters, DateAr, MoneyInput, MeterInput              | `apps/web/src/shared/format/`    | `@/shared/format`                   |
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

- Change a token only with the owner's approval. [apps/web/src/app/tokens.contrast.test.ts](../apps/web/src/app/tokens.contrast.test.ts) checks every semantic pair in both themes: text ≥ 4.5:1, input borders and focus ring ≥ 3:1. Never lower a threshold; fix the token, with approval.
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
- Forms use `Field` (shadcn replaced `form` with `field`) + react-hook-form + zod. Pattern: label above, error below with an icon (see the gallery's sale-line form).
- Sheet and Sidebar position by a _physical_ `side` prop, so their side classes are physical (with a lint exception). The app sidebar is `side="right"`.
- English screen-reader strings ("Close", "Toggle Sidebar"…) are replaced with `messages.ui.*`.
- `Calendar` defaults to the `ar-MA` locale and RTL.

To add a component, run from `apps/web`: `pnpm dlx shadcn@4.23.0 add <name>`. Then run `pnpm prettier --write src/shared/ui`, replace any English labels with i18n strings, add `font-heading` to its title if it has one (the CLI strips it in this project), and run `make check`. The design-system lint will flag any physical class or raw colour it brings. Some type-aware rules are relaxed for `src/shared/ui` only, to keep it close to upstream (see `packages/config-eslint/next.js`).

## Brand (`@/shared/brand`)

```tsx
<AppShell
  nav={shopNavigation} // src/app/navigation.ts; `tab: true` = phone tab
  title={messages.nav.pos}
  onSearch={() => setSearchOpen(true)} // also Ctrl+K / ⌘K
  status={<ConnectivityStatus pendingCount={outboxSize} />}
  actions={<ThemeToggle />}
>
  {content}
</AppShell>
```

- Desktop: burgundy sidebar on the right, collapsible to icons. The active item gets a lighter background and a gold diamond. Phone: 4 tabs plus "المزيد", a drawer with the rest.
- `Logo` (`variant="full" | "mark"`): size it with `w-*` or `h-*`.
- `DiamondBullet`: decorative, sized by font size (`text-xs`).
- `EmptyState`, `ErrorState` (`onRetry`), `LoadingState` (`variant="skeleton" | "spinner"`). Pass `titleAs="h3"` when nested under an `h2`.

## Format (`@/shared/format`)

```tsx
<Money cents={line.totalCents} />                 // "410 ريال" or "20.50 د" (setting)
<Money cents={profitCents} tone="profit" />       // tones: profit | loss | debt | capital | estimated
<Meters cm={275} />                               // "2.75 م"
<DateAr value={sale.date} format="long" />        // "29 أكتوبر 2026", Africa/Casablanca
<MoneyInput value={cents} onValueChange={setCents} required />
<MeterInput value={cm} onValueChange={setCm} />
```

- Everything goes through `@fabric/core` (`formatMoneyAmount`, `parseMoneyInput`, `formatLengthMeters`, `parseLengthInput`); no number logic lives in web.
- Plain text (WhatsApp invoice, toasts, CSV): use core's `formatMoney(cents, unit)` → "410 ريال" and `formatLength(cm)` → "2.75 م". They join number and unit with a no-break space and put an LRM before a minus sign, so "-410" doesn't flip in Arabic text. Components keep rendering digits (in `<bdi>`) and label separately.
- Display unit: `MoneyUnitProvider` holds the `money_display_unit` setting (rial by default). `MoneyUnitToggle` switches it; it moves to local-db settings in BUILD_PROMPTS 3.1.
- Inputs accept Arabic-Indic and Persian digits and `.`/`٫`/`,` as the decimal point, use `inputmode="decimal"` and return integer cents/cm, or `null` while empty or invalid. Thousands separators are rejected.
- Rial input must be a whole number of cents: half a rial (2.5 cents) is rejected with a message, never rounded (SPEC §0.2).
- Errors show after the first blur; pass `showError` to show them after a submit attempt.

## Gallery (`/design`)

`src/app/(dev)/design/page.dev.tsx` and `shell/page.dev.tsx` are routes only under `next dev` (`pageExtensions` in `next.config.ts`). A production build has no `/design` and does not bundle its copy (`src/i18n/ar.design.ts`). It renders every token, component, brand piece and format, plus RTL checks: flipped directional icons, logical spacing, alignment and mixed text. It also embeds `/design/shell` at desktop and phone sizes. Switch theme and money unit from its header.

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

`src/app/manifest.ts`: name/short_name غيث, `dir: rtl`, `lang: ar`, `display: standalone`, theme and background `#491017`, icons from `/brand` (192, 512 and maskable 512). Favicon and Apple icon are `src/app/icon.png` and `apple-icon.png`. The service worker and offline caching arrive with BUILD_PROMPTS 3.1.
