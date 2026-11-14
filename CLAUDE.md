# CLAUDE.md

Fabric Shop OS: POS, inventory, credit, partner settlement and zakat for a fabric shop in Morocco (MAD). One owner + one partner, a touch tablet at the till (the cashier's), desktop for the owner, phone for lookup. One server is being built to serve many shops: each shop has its own database, and the address of the request chooses it ([ADR 0029](docs/adr/0029-multi-shop-database-isolation.md), [docs/MULTI_SHOP_PLAN.md](docs/MULTI_SHOP_PLAN.md)). It is built one step at a time, only when the owner asks for the next step, and it is off unless `MULTI_SHOP=true`; with the flag off the server is the one-shop server it always was. Nothing inside a database separates shops: no table has a shop id.

- Product source of truth: [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) (Arabic). `SPEC §n` below refers to its sections.
- Build order, folder tree and per-slice prompts: [docs/BUILD_PROMPTS.md](docs/BUILD_PROMPTS.md).
- Architecture decisions: [docs/adr/](docs/adr/).
- If code, this file, the spec and BUILD_PROMPTS disagree, stop and ask. Never resolve a conflict by guessing.

## Stack

- pnpm workspaces + Turborepo monorepo.
- `apps/api`: NestJS modular monolith on PostgreSQL with Drizzle ORM and drizzle-kit SQL migrations ([ADR 0003](docs/adr/0003-orm.md)). Money columns are `bigint` in `number` mode.
- `apps/web`: Next.js App Router, installable PWA, English (default) and Arabic RTL. Local DB: IndexedDB via Dexie.
- `packages/core` (`@fabric/core`): pure accounting logic. `packages/contracts` (`@fabric/contracts`): zod schemas and shared types for API and sync.
- Docker for dev and prod (`infra/docker`).
- TypeScript `strict` in every app and package. No `any`, `@ts-ignore` or `@ts-expect-error` without a comment saying why.
- Toolchain: Node 24 LTS (`.nvmrc`, `nvm use`), pnpm pinned via `packageManager` (corepack). Shared versions live in the `catalog:` of `pnpm-workspace.yaml`.
- TypeScript stays on 6.0.x until typescript-eslint supports newer. ESLint 10 flat config; Next linting uses `@next/eslint-plugin-next` + react-hooks + `@eslint-react` (eslint-config-next's bundled plugins don't support ESLint 10 yet).
- Workspace packages are ESM, built with tsup to `dist/`; turbo builds dependencies first (`^build`).

## Money, length, weight

- Stored and transported as integers only: money in cents (`*_cents`, bigint in Postgres), length in cm (`*_cm`), weight in grams (`*_g`).
- 1 dirham = 20 rial = 100 cents (1 rial = 5 cents). 1 m = 100 cm.
- No floating point for any stored or accounting value. Parse decimal input as strings; round only through the explicit half-up helpers in `@fabric/core`.
- Users never type or see cents or cm. They type and read decimals (2.75 m, 20.5 dh), in rial or dirham per the `money_display_unit` setting (default `rial`).
- Conversion happens only at the UI boundary (input parsing, display formatting), using the `@fabric/core` money/length helpers. API, contracts, DB and sync payloads carry integers only. See SPEC §0.
- SPEC §16 tests are written in dirham and must pass whatever the display unit.

## Accounting logic

- Lives ONLY in `packages/core`: pure functions, no I/O, no network, no DB, no reading the clock or randomness (pass them in). `core` has no runtime dependencies.
- 100% unit-tested: every exported function has tests, SPEC §16 examples (T1–T16) are encoded verbatim, invariants get property-based tests (fast-check). CI coverage floor: 95% lines (BUILD_PROMPTS 1.5).
- Never duplicate it in `apps/api` or `apps/web` (services, components, SQL, views). Call core. The API re-validates every write with the same core functions.
- Rules marked [قابل للإعداد] (configurable) in the spec live in the `setting` table, not in code.
- Rules core implements where the spec is silent are listed in [docs/accounting-assumptions.md](docs/accounting-assumptions.md). Add every new one there; don't build on an `open` row without the owner's decision.
- **Ask before assuming anything about accounting rules.** If the spec is silent or ambiguous (rounding, recognition timing, who gets an odd cent, period boundaries…), stop and ask the owner. Never pick a default silently.

## Data rules

- Every table has: `id` (uuid, client-generated), `created_at`, `updated_at`, `device_id`, `voided_at` (nullable), `server_seq` (one global sequence, for sync). In the schema: `...baseColumns('<table>')`; in its migration: `SELECT install_row_guards('<table>', <append_only>)` (refuses DELETE/TRUNCATE, UPDATE on append-only tables). An integration test fails for a table without them.
- The control database (`fabric_control`; only with `MULTI_SHOP=true`; [ADR 0029](docs/adr/0029-multi-shop-database-isolation.md)) is the one exception to the base-columns rule: it is not shop data and it is not synced, so its tables have no `server_seq` or `device_id`. Its migrations are in `apps/api/drizzle-control` (`make migrate-new NAME=… CONTROL=1`), applied before the shops' migrations. The other data rules hold there: nothing is deleted (a shop is closed, an address is released), what identifies a row never changes, `shop_event` is append-only. A new control table calls `SELECT install_control_guards('<table>', <append_only>)` in its migration; an integration test fails for a control table without it.
- With `MULTI_SHOP=true`, `TransactionHost.db` is the database of the shop that the work is bound to (`bindShop`, once for each request, from its address; `ShopsService.runAsShop(slug, work)` for a command or a test). Never make a pool or a Drizzle client for a shop anywhere else, and never bind a shop inside another one's work: it throws.
- Append-only: `product_stock_move` (and the legacy `stock_move`), `sale_line`, `payment`, `payment_allocation`, `sale_void`, `sale_return`, `write_off`, `audit_log` are never updated or deleted. Corrections are compensating records (a `reversal` stock move, a `refund` payment, a `sale_return` with its `return` moves).
- No hard delete anywhere. Cancellation sets `voided_at` with a reason and is audit-logged.
- Balances are derived from movements, never stored as an editable field: batch remaining quantity (`product_batch`, [ADR 0012](docs/adr/0012-product-batches-single-stock-source.md)), customer balance, partner balance, partner capital, cash. A derived cache is fine if it can be rebuilt from movements.
- Every change or void writes `audit_log` (who, when, entity, id, action, before, after, reason) through `AuditService.record`. A mutating request is one transaction that commits only if it wrote an audit entry ([ADR 0004](docs/adr/0004-api-foundation.md)); `@AuditExempt(why)` is the rare exception.
- Roles (SPEC §11): the owner changes everything, a partner reads everything, a cashier sells and **never receives a cost or a profit**. Enforce it on the API, never only in the UI: the AuthGuard admits a cashier only on `@CashierMayCall()` routes, and the sync hub sends and accepts by `CASHIER_ACCESS` in `@fabric/contracts` ([ADR 0007](docs/adr/0007-returns-payables-roles.md)). A new synced entity must be listed there (the compiler refuses otherwise); a new REST route is closed to cashiers unless marked.
- Login accounts ([ADR 0024](docs/adr/0024-account-management.md)): the owner makes cashier and partner accounts in Settings > Accounts; the role comes from the route, never from the client. A partner account belongs to exactly one existing partner (one active login per partner, enforced by the database). An account is not a partner or an employee: switching one off (`deactivated_at`, never a delete) removes no business record. Accounts are server-owned and online-only, like settings; a partner never receives another partner's money records or contact details.
- Many shops ([ADR 0029](docs/adr/0029-multi-shop-database-isolation.md)): an account lives in one shop's database and means nothing at another shop. The sign-in and sign-up pages have no shop field: the address of the request chooses the shop. An access token carries the shop id and is signed with that shop's own key (derived from `JWT_ACCESS_SECRET`), so another shop's token is refused with 401 before any user is read; the refresh cookie has no `Domain`, so each address keeps its own. A new shop has no owner until its setup code (`make shop-new`) is used at its sign-up. Code that runs outside a request (the `make` commands) names the shop with `SHOP=<slug>` and never falls back to a default one. Two shops are tested against each other (`apps/api/test/cross-shop.e2e-spec.ts`, `apps/web/e2e/second-shop.spec.ts`): a new route, synced entity or command keeps those tests green.
- Records inside a locked settlement period change only through an explicit, audit-logged unlock. A dated synced entity must be in `periodDatesOf` (`@fabric/contracts`) so the lock covers it ([ADR 0005](docs/adr/0005-settlement-and-period-lock.md)).

## Structure and dependency rules

Folder tree: BUILD_PROMPTS §1.2. Organise by feature, not by file type. Dependency directions (BUILD_PROMPTS §1.3, plus the `app`, `local-db` and `i18n` rows needed to make it complete), enforced by eslint-plugin-boundaries (`packages/config-eslint`) and dependency-cruiser (`.dependency-cruiser.cjs`, `make deps`):

```
packages/core       → imports nothing (no npm packages, no Node builtins)
packages/contracts  → zod, core
api/modules/*       → core, contracts, api common/config/database; another module only via its index.ts
api/common          → config; never modules
api/main.ts, app.module.ts → module index files, common, config, database
web/app             → feature index files, shared, local-db, i18n (routing only)
web/features/*      → core, contracts, shared, local-db, i18n; another feature only via its index.ts
web/shared          → i18n; never features
web/local-db        → shared
```

- Files inside one module/feature import each other freely.
- Import workspace packages by name (`@fabric/core`), never by a relative path into another package.

- NestJS module layout: `*.module.ts`, `*.controller.ts`, `*.service.ts` (application layer), `*.repository.ts` (data access only, on `TransactionHost.db`), `*.spec.ts`, `index.ts` (the only public surface). Input through `ZodBody`/`ZodQuery`/`ZodParam`, output through `ZodResponse` (`src/common/zod.ts`), with schemas from `@fabric/contracts`; a `dto/` folder only for shapes that are not in contracts. Routes are protected unless `@Public()`.
- Next.js `app/` is routing only; pages are thin and compose `features/`.
- Web features never touch Dexie or `fetch` directly; they go through `local-db` repositories (`useRepositories`, `useLiveQuery`); lint enforces it.
- A new synced entity: add it to `SYNC_ENTITIES` in `@fabric/contracts`, register a `SyncHandler` in its API module, add its Dexie table in a new `version()` of `ShopDatabase` (never edit a released one), and its repository in `local-db`. Records created together (a purchase with its batches and moves) travel as one `append` op with a `pushSchema`; build them with one shared function in `@fabric/contracts`, which the server re-runs to check them. A record that carries bytes (a product's `photo`) is weighed in `syncWeightOf`, so pushes and pulls are cut by size as well as count, and its handler keeps the bytes out of the audit log (`auditView`); see [ADR 0009](docs/adr/0009-product-photos.md).
- Record pages take the record as `?id=` (the service worker ignores that parameter); after a save, navigate with `useAppNavigation` (`shared/lib/navigation`) so it also works offline.

## Offline-first

See [ADR 0002](docs/adr/0002-offline-first.md). Every operation commits to the local DB first and queues a sync op in the outbox; sync runs in the background in both directions. A screen that only works online is a bug.

## UI

- Two languages: English (`en`, the default, LTR) and Arabic (`ar`, RTL). Each device picks from the language icon in the header and keeps the choice (`localStorage`, not synced); `<html lang dir>` and the layout follow it ([ADR 0008](docs/adr/0008-languages.md)). Western digits 0–9 for display; inputs also accept Arabic-Indic digits.
- All user-facing strings go through i18n (`apps/web/src/i18n`). Never hardcode Arabic or English (or any user-facing text) in components. A text is added to **both** `ar.ts` and `en.ts` (the compiler refuses a missing or extra key); counts use `plural()`.
- Read `messages.x` where it is shown (in a component or a function). Never copy a text into a module-level constant: it would keep the language it loaded in (build such lists inside a function, like `shopNavigation()`). Data the user typed (names, notes, reasons) is never translated.
- Gregorian dates; Hijri only in the zakat module.
- The till is a touch tablet: the POS has big tap targets and no need for the system keyboard (the `Keypad` types lengths, prices and amounts into `inputMode="none"` fields; a physical keyboard still works). Desktop for the owner's screens; phone for lookup and quick sales.
- No barcode, no printing. Invoices are shared as WhatsApp text.

## UI rules

- Only use shadcn/ui components from src/shared/ui; colors only via semantic tokens (bg-primary, text-muted-foreground, text-profit…), never raw hex or Tailwind palette colors.
- Gold (#D8A123) is never used as text on light surfaces; use text-gold-800 there. Gold text is fine on burgundy/dark.
- One accent (gold) primary action per screen. Meaning is never conveyed by color alone.
- Direction follows the language: logical Tailwind classes only (ms-/me-/ps-/pe-/start-/end-/text-start/text-end). Where code must pick a physical side (sidebar, chart axes, toasts), read `useDirection()` / `useLanguage()`.
- Always render money/lengths via <Money/>, <Meters/>, <MoneyInput/>, <MeterInput/>.
- Every screen implements loading, empty, error and offline states.
- The built-in logo appears only on burgundy backgrounds. The shop's own logo (the owner uploads it in Settings, `shop_logo`) goes on a white tile through `BrandMark`; the shop's name and logo come only from `useShopIdentity()` / `shop_name` / `shop_logo` ([ADR 0017](docs/adr/0017-settings-workspace.md)).
- Settings (`shop_name`, `shop_logo`, `money_display_unit`, …) are server-owned: written online through `repositories.settings.save`, read from the device. Partners live under Settings (`/settings/partners`), not in the sidebar.
- Tokens in globals.css are brand-tokens.css verbatim: change them only with the owner's approval; tokens.contrast.test.ts must stay green (never lower its thresholds).

How-to: [docs/design-usage.md](docs/design-usage.md); brand rationale: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md); live gallery: `/design` (dev server only).

## Commands

`make help` lists everything. Docker targets take `STACK=dev` (default) or `STACK=prod`.

| Command                        | Does                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make up` / `make down`        | Start (and wait until healthy) / stop the stack; volumes are kept                                                                                                                           |
| `make logs SERVICE=api`        | Follow logs                                                                                                                                                                                 |
| `make test`                    | Run all tests                                                                                                                                                                               |
| `make check`                   | Typecheck + lint + tests                                                                                                                                                                    |
| `make deps`                    | Dependency-direction check (dependency-cruiser)                                                                                                                                             |
| `make migrate`                 | Apply pending migrations; MULTI_SHOP needs `SHOP=<slug>` or `SHOP=all`                                                                                                                      |
| `make migrate-new NAME=…`      | Generate a migration from the schema (`CUSTOM=1`: empty, hand-written SQL)                                                                                                                  |
| `make shop-adopt SLUG=…`       | Adopt the live shop as shop 1 (`HOST=` its address); run before the flag                                                                                                                    |
| `make shop-new SLUG=…`         | Make a shop and its setup code (shown once); `HOST=`, `LABEL=`; re-run to go on                                                                                                             |
| `make shop-list`               | The shops: state, addresses, schema, owner, setup code                                                                                                                                      |
| `make shop-suspend SLUG=…`     | Refuse a shop (`REASON=`) until `shop-resume`; its tablets keep selling                                                                                                                     |
| `make shop-resume SLUG=…`      | Serve a suspended shop again                                                                                                                                                                |
| `make shop-code SLUG=…`        | A new setup code, only while the shop has no owner; the old one stops                                                                                                                       |
| `make shop-host SLUG=…`        | One more address for a shop (`HOST=`)                                                                                                                                                       |
| `make shop-close SLUG=…`       | End a shop for good (`REASON=`, `CONFIRM=<slug>`); the data stays                                                                                                                           |
| `make owner USERNAME=…`        | Create the owner account or reset its password (MULTI_SHOP: `SHOP=<slug>`); see docs/runbooks/api.md                                                                                        |
| `make partner-user USERNAME=…` | A partner's login; needs `PARTNER=…` (MULTI_SHOP: `SHOP=<slug>`; also in Settings > Accounts)                                                                                               |
| `make cashier-user USERNAME=…` | A cashier's account: sells, never sees a cost or a profit (create or reset; MULTI_SHOP: `SHOP=<slug>`)                                                                                      |
| `make e2e`                     | Playwright on the real stack (Postgres container, API, web build): offline                                                                                                                  |
| `make e2e-shops`               | The same Playwright run on a server with many shops: the shop adopted, a second shop that signs up, sells offline and syncs                                                                 |
| `make backup`                  | Compressed, timestamped Postgres dump, keeps the newest 14; MULTI_SHOP: one folder for each shop that is not closed and one for `control/`, 14 in each (`SHOP=<slug>` or `control` for one) |
| `make backup-verify`           | Fresh dump restored into a scratch DB, row counts compared (MULTI_SHOP: each shop and `control`)                                                                                            |
| `make restore FILE=… [DB=…]`   | Restore a dump (app DB asks for confirmation; MULTI_SHOP: `SHOP=<slug>` or `control`, and the dump must be of that database); see docs/runbooks/backup.md                                   |
| `make export [FILE=…]`         | The shop's data as one JSON file (what devices sync; MULTI_SHOP: `SHOP=<slug>`)                                                                                                             |
| `make import FILE=…`           | Load an export (server's or a device's) into an empty database (MULTI_SHOP: `SHOP=<slug>`)                                                                                                  |

- Dev stack (`infra/docker/compose.dev.yml`): api http://localhost:4000, web http://localhost:3000 (it proxies `/api` to the API), Postgres on 127.0.0.1:5440, pgAdmin with `PROFILES=tools`. Source is mounted with hot reload; node_modules live in Docker volumes. The service worker is off under `next dev`.
- Production: [docs/runbooks/deploy.md](docs/runbooks/deploy.md) (VPS, HTTPS, updates, rollback); nightly backups run in the prod stack. MVP sign-off: [docs/MVP_ACCEPTANCE.md](docs/MVP_ACCEPTANCE.md).
- Env: every variable is documented in `.env.example`; the API validates its env with zod at startup (`apps/api/src/config`) and exits on invalid config. Never bake secrets into images.

## Definition of done

1. `make check` passes (typecheck + lint + tests).
2. The feature works offline (verified, not assumed) and syncs once back online.
3. Docs updated: the spec (only with owner approval), an ADR for any architectural decision, runbooks for ops changes.

## Working rules

- Build phase by phase (SPEC §15, BUILD_PROMPTS order). Don't build later-phase features early, but leave room for them.
- Ask before assuming anything about accounting rules.
