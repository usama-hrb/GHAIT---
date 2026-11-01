# ADR 0008: Two interface languages, English by default

- Status: Accepted
- Date: 2026-10-31

## Context

The owner asked for English in the app, as the default language, with an icon to change language. Until now the interface was Arabic only (SPEC §0.4, CLAUDE.md). Four things shape the design:

- The app is offline-first and its pages are prerendered and cached by the service worker (ADR 0002). The server cannot choose a language per request: the same cached HTML serves every device.
- About 1,400 texts are read as `messages.x.y` in hundreds of places, many through module-level aliases (`const t = messages.pos`). Turning each into a hook call would be a huge diff with no gain.
- Direction, fonts, and several components depend on the language: the sidebar side, toasts, chart axes, the calendar, dates, and the text of a shared invoice.
- Accounting must not depend on language. Money, length and weight stay integers (cents, cm, g) in storage, sync and `@fabric/core`; only their labels differ.

## Decision

**Languages.** `en` (default, LTR, `en-GB` dates) and `ar` (RTL, `ar-MA` dates). Gregorian dates and Western digits in both; Hijri stays in the zakat module.

**The choice belongs to the device.** It is kept in `localStorage` (`fabric.language`) and is not synced: the desk can be English while an assistant's phone is Arabic. No choice means English, whatever the browser's locale. The header (and the login page) has a language icon that opens the list; each language is named in its own script.

**The server and the first render always show the default.** The static HTML is English, so a hydrated page matches it. A small inline script in `<head>` (`languageBootScript`) puts the device's language on `<html lang dir>` before the first paint and, for a non-default language, marks the page `data-lang-pending`; `globals.css` keeps the body hidden until the `LanguageProvider` has switched the texts (a few blank milliseconds instead of a flash of English), with a 2-second CSS failsafe so a failed script never leaves the page blank. A `storage` listener follows a change made in another tab.

**Texts.** `ar.ts` is the reference; its type (`Messages`, strings widened) is the shape of `en.ts`, so the compiler refuses a missing or extra key. `messages` is a live view (a cached `Proxy` per path) of the catalog of the language shown at the moment a text is read, so existing code and module-level aliases keep working. Because texts are read while rendering, `LanguageBoundary` remounts the screens when the language changes (below the database, session and settings providers, so those keep their state). Reading a text into a module-level constant freezes the language it loaded in; the few places that did (navigation labels, the logo's alt text, the theme and unit toggles, the stock-move dialog titles) now read at render time, and CLAUDE.md states the rule.

**Counting.** `plural(count, forms)` uses `Intl.PluralRules` of the catalog's own language (`pluralFor`), with `zero` for an empty count. Arabic uses six forms, English two.

**Direction.** The page's `dir` follows the language, so logical Tailwind classes flip by themselves. Code that needs a physical side reads `useDirection()` (sidebar `side`, chart axes, calendar, toast position).

**Generated text.** The invoice and the account statement shared on WhatsApp are written in the language shown. `@fabric/core` gained the English unit labels (`dh`, `rial`, `m`, `kg`) next to the Arabic ones, selected by the `locale` argument its formatters already had.

**Data stays as entered.** Names, notes and reasons are not translated, nor is the `shop_name` setting. The shipped expense categories are stored with Arabic labels in the settings default; `categoryName()` shows them by key in the language shown and keeps the name of one the owner renamed or added.

**Fonts.** English text and headings use IBM Plex Sans; Arabic keeps IBM Plex Sans Arabic and Noto Kufi Arabic. `html[lang='en']` swaps the two font variables.

## Consequences

- Every new text needs an entry in both catalogs; the compiler and `catalogs.test.ts` enforce it. A third language is a new catalog, an entry in `LANGUAGES`/`LANGUAGE_INFO`, and the core unit labels.
- The page `<title>` and the web manifest come from the server and stay in the default language (only the brand name, "Ghaith"); every screen follows the device's choice.
- The dev-only design gallery (`/design`) stays Arabic.
- A fix found on the way: the `hijri` date format was being overridden by the Gregorian calendar and showed Gregorian dates; the options now apply in the right order.
- Tests: web unit tests start in Arabic (`src/test-setup.ts`) because most were written against the Arabic texts; English has its own unit tests and `e2e/language.spec.ts`. The e2e helper `signIn()` opens pages in Arabic.
- SPEC §0.4 and §12.2 changed at the owner's request (SPEC §19).
