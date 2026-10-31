# CLAUDE.md

Fabric Shop OS: POS, inventory, credit, partner settlement and zakat for a single fabric shop in Morocco (MAD). One owner + one partner, desktop (main till) + phone. Not multi-tenant; keep the structure clean enough to become a SaaS later.

- Product source of truth: [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) (Arabic). `SPEC §n` below refers to its sections.
- Build order, folder tree and per-slice prompts: [docs/BUILD_PROMPTS.md](docs/BUILD_PROMPTS.md).
- Architecture decisions: [docs/adr/](docs/adr/).
- If code, this file, the spec and BUILD_PROMPTS disagree, stop and ask. Never resolve a conflict by guessing.

## Stack

- pnpm workspaces + Turborepo monorepo.
- `apps/api`: NestJS modular monolith on PostgreSQL with Drizzle ORM and drizzle-kit SQL migrations ([ADR 0003](docs/adr/0003-orm.md)). Money columns are `bigint` in `number` mode.
- `apps/web`: Next.js App Router, installable PWA, Arabic RTL. Local DB: IndexedDB via Dexie.
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
- 100% unit-tested: every exported function has tests, SPEC §16 examples (T1–T14) are encoded verbatim, invariants get property-based tests (fast-check). CI coverage floor: 95% lines (BUILD_PROMPTS 1.5).
- Never duplicate it in `apps/api` or `apps/web` (services, components, SQL, views). Call core. The API re-validates every write with the same core functions.
- Rules marked [قابل للإعداد] (configurable) in the spec live in the `setting` table, not in code.
- Rules core implements where the spec is silent are listed in [docs/accounting-assumptions.md](docs/accounting-assumptions.md). Add every new one there; don't build on an `open` row without the owner's decision.
- **Ask before assuming anything about accounting rules.** If the spec is silent or ambiguous (rounding, recognition timing, who gets an odd cent, period boundaries…), stop and ask the owner. Never pick a default silently.

## Data rules

- Every table has: `id` (uuid, client-generated), `created_at`, `updated_at`, `device_id`, `voided_at` (nullable), `server_seq` (one global sequence, for sync). In the schema: `...baseColumns('<table>')`; in its migration: `SELECT install_row_guards('<table>', <append_only>)` (refuses DELETE/TRUNCATE, UPDATE on append-only tables). An integration test fails for a table without them.
- Append-only: `stock_move`, `sale_line`, `payment`, `payment_allocation`, `sale_void`, `write_off`, `audit_log` are never updated or deleted. Corrections are compensating records (a `reversal` stock move, a `refund` payment).
- No hard delete anywhere. Cancellation sets `voided_at` with a reason and is audit-logged.
- Balances are derived from movements, never stored as an editable field: roll remaining length, customer balance, partner balance, partner capital, cash. A derived cache is fine if it can be rebuilt from movements.
- Every change or void writes `audit_log` (who, when, entity, id, action, before, after, reason) through `AuditService.record`. A mutating request is one transaction that commits only if it wrote an audit entry ([ADR 0004](docs/adr/0004-api-foundation.md)); `@AuditExempt(why)` is the rare exception.
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
- A new synced entity: add it to `SYNC_ENTITIES` in `@fabric/contracts`, register a `SyncHandler` in its API module, add its Dexie table in a new `version()` of `ShopDatabase` (never edit a released one), and its repository in `local-db`. Records created together (a purchase with its rolls and moves) travel as one `append` op with a `pushSchema`; build them with one shared function in `@fabric/contracts`, which the server re-runs to check them.
- Record pages take the record as `?id=` (the service worker ignores that parameter); after a save, navigate with `useAppNavigation` (`shared/lib/navigation`) so it also works offline.

## Offline-first

See [ADR 0002](docs/adr/0002-offline-first.md). Every operation commits to the local DB first and queues a sync op in the outbox; sync runs in the background in both directions. A screen that only works online is a bug.

## UI

- Arabic, RTL (`lang="ar"`, `dir="rtl"`). Western digits 0–9 for display; inputs also accept Arabic-Indic digits.
- All user-facing strings go through i18n (`apps/web/src/i18n`). Never hardcode Arabic (or any user-facing text) in components.
- Gregorian dates; Hijri only in the zakat module.
- Desktop first; phone for lookup and quick sales.
- No barcode, no printing. Invoices are shared as WhatsApp text.

## UI rules

- Only use shadcn/ui components from src/shared/ui; colors only via semantic tokens (bg-primary, text-muted-foreground, text-profit…), never raw hex or Tailwind palette colors.
- Gold (#D8A123) is never used as text on light surfaces; use text-gold-800 there. Gold text is fine on burgundy/dark.
- One accent (gold) primary action per screen. Meaning is never conveyed by color alone.
- RTL: logical Tailwind classes only (ms-/me-/ps-/pe-/start-/end-/text-start/text-end).
- Always render money/lengths via <Money/>, <Meters/>, <MoneyInput/>, <MeterInput/>.
- Every screen implements loading, empty, error and offline states.
- The logo appears only on burgundy backgrounds.
- Tokens in globals.css are brand-tokens.css verbatim: change them only with the owner's approval; tokens.contrast.test.ts must stay green (never lower its thresholds).

How-to: [docs/design-usage.md](docs/design-usage.md); brand rationale: [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md); live gallery: `/design` (dev server only).

## Commands

`make help` lists everything. Docker targets take `STACK=dev` (default) or `STACK=prod`.

| Command                        | Does                                                                       |
| ------------------------------ | -------------------------------------------------------------------------- |
| `make up` / `make down`        | Start (and wait until healthy) / stop the stack; volumes are kept          |
| `make logs SERVICE=api`        | Follow logs                                                                |
| `make test`                    | Run all tests                                                              |
| `make check`                   | Typecheck + lint + tests                                                   |
| `make deps`                    | Dependency-direction check (dependency-cruiser)                            |
| `make migrate`                 | Apply pending migrations (the API also applies them on start)              |
| `make migrate-new NAME=…`      | Generate a migration from the schema (`CUSTOM=1`: empty, hand-written SQL) |
| `make owner USERNAME=…`        | Create the owner account or reset its password; see docs/runbooks/api.md   |
| `make partner-user USERNAME=…` | The partner's read-only account (create, or reset its password)            |
| `make e2e`                     | Playwright on the real stack (Postgres container, API, web build): offline |
| `make backup`                  | Compressed, timestamped Postgres dump, keeps the newest 14                 |
| `make backup-verify`           | Fresh dump restored into a scratch DB, row counts compared                 |
| `make restore FILE=… [DB=…]`   | Restore a dump (app DB asks for confirmation); see docs/runbooks/backup.md |
| `make export [FILE=…]`         | The shop's data as one JSON file (what devices sync)                       |
| `make import FILE=…`           | Load an export (server's or a device's) into an empty database             |

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
