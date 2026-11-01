# خطة البناء والـ Prompts لـ Claude Code

**المكدس:** NestJS (API) + Next.js (PWA) + PostgreSQL + Docker، داخل monorepo واحد (pnpm + Turborepo) وTypeScript في كل مكان.
**المرجع:** `docs/PROJECT_SPEC.md` (ملف المواصفات). كل prompt هنا يحيل إلى أقسامه.

---

## كيف تستخدم هذا الملف

1. ضع `PROJECT_SPEC.md` في مجلد `docs/` داخل المشروع قبل أن تبدأ.
2. نفّذ **prompt واحداً في كل مرة**، بالترتيب. لا تنتقل للتالي قبل أن تتحقق من قائمة "كيف تتأكد" وتعمل `git commit`.
3. للـ prompts الكبيرة اطلب من Claude Code أولاً أن يعرض **خطة** قبل التنفيذ (plan mode)، وراجعها.
4. بعد كل شريحة (feature) ابدأ جلسة جديدة؛ ملف `CLAUDE.md` (Prompt 0.1) يحمل الذاكرة الدائمة للمشروع.
5. الـ prompts مكتوبة بالإنجليزية لأنها تعطي أدق نتيجة مع Claude Code، وشروحي بالعربية.
6. إذا فشل شيء أو خالف Claude Code المواصفات، لا تعدّل الكود يدوياً أولاً: قل له "هذا يخالف القسم X من SPEC، أصلحه".

---

## 1. هيكل الملفات المعتمد

### 1.1 المبادئ (من أفضل الممارسات المنشورة)

- **التنظيم حسب الميزة (feature) لا حسب نوع الملف**: ما يتعلق بالمشتريات في مكان واحد، لا موزعاً بين `controllers/` و`services/` و`models/` عامة.
- **الاعتماد باتجاه واحد**: `shared` لا يستورد أبداً من `features`، والميزة تستورد من ميزة أخرى فقط عبر واجهتها العامة (`index.ts`).
- **المنطق النقي في حزمة مستقلة** (`packages/core`) تُستعمل في الـ API وفي المتصفح (لأن التطبيق يعمل offline).
- **monolith مقسَّم إلى modules** (modular monolith) في NestJS: خدمة واحدة تُنشر بسهولة، وكل module مغلق بما يكفي ليُفصل لاحقاً.
- **الصفحات في Next.js رفيعة**: `app/` للتوجيه فقط، والمنطق والمكونات في `features/`.
- **كل شيء يُفرض آلياً** (ESLint boundaries + dependency-cruiser)، فالمشروع يبقى نظيفاً حتى لو تغيّرت الفرق أو استخدمنا أدوات ذكاء اصطناعي.

### 1.2 الشجرة

```
fabric-shop/
├── apps/
│   ├── api/                              # NestJS
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/                   # guards, filters, interceptors, pipes (لا يستورد من modules)
│   │   │   ├── config/                   # env schema + validation
│   │   │   ├── database/                 # prisma client, migrations, seeds
│   │   │   └── modules/                  # كل module = ميزة
│   │   │       ├── catalog/              # fabric, variant, supplier
│   │   │       ├── purchasing/           # purchase → rolls
│   │   │       ├── inventory/            # rolls, stock_moves, corrections, loss
│   │   │       ├── sales/                # sale, sale_line
│   │   │       ├── customers/            # customer, payment, debts
│   │   │       ├── expenses/
│   │   │       ├── partners/             # partner, capital_move, partner_draw
│   │   │       ├── settlements/
│   │   │       ├── zakat/
│   │   │       ├── sync/                 # push/pull
│   │   │       ├── audit/
│   │   │       ├── settings/
│   │   │       └── auth/
│   │   │
│   │   │   # الشكل الداخلي لأي module (مثلاً purchasing/):
│   │   │   #   purchasing.module.ts
│   │   │   #   purchasing.controller.ts
│   │   │   #   purchasing.service.ts       # طبقة التطبيق
│   │   │   #   purchasing.repository.ts    # الوصول للبيانات فقط
│   │   │   #   dto/                        # مشتقة من packages/contracts
│   │   │   #   purchasing.service.spec.ts
│   │   │   #   index.ts                    # الواجهة العامة الوحيدة
│   │   └── test/                         # e2e
│   └── web/                              # Next.js PWA (إنجليزي افتراضي + عربي RTL)
│       └── src/
│           ├── app/                      # توجيه فقط، صفحات رفيعة
│           ├── features/                 # نفس أسماء modules
│           │   ├── catalog/{components,hooks,queries,commands,index.ts}
│           │   ├── purchasing/ …
│           │   ├── pos/ …
│           │   └── …
│           ├── local-db/                 # قاعدة المتصفح + outbox + محرك المزامنة
│           ├── shared/                   # ui/, hooks/, lib/ (لا يستورد من features)
│           └── i18n/                     # en (الافتراضية) + ar (RTL)
├── packages/
│   ├── core/                             # المنطق المحاسبي النقي (بلا أي اعتماد خارجي)
│   │   └── src/{money,length,costing,pricing,payments,settlement,integrity,zakat}/
│   ├── contracts/                        # مخططات zod + أنواع مشتركة (API + sync)
│   ├── config-ts/                        # tsconfig الأساسية
│   └── config-eslint/                    # قواعد eslint + حدود الاعتماد
├── infra/
│   ├── docker/                           # Dockerfile.api, Dockerfile.web, compose.*.yml, nginx
│   └── scripts/                          # backup.sh, restore.sh, seed
├── docs/
│   ├── PROJECT_SPEC.md
│   ├── adr/                              # قرارات معمارية (0001-*.md …)
│   └── runbooks/                         # نشر، نسخ احتياطي، استرجاع
├── .github/workflows/ci.yml
├── Makefile
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example
└── CLAUDE.md
```

### 1.3 قواعد الاعتماد (تُفرض آلياً)

```
core            ← لا يستورد من أي شيء
contracts       ← يستورد core فقط (إن لزم)
api/modules/*   ← core, contracts, common/config/database؛ بين modules عبر index.ts فقط
web/features/*  ← core, contracts, shared, local-db؛ بين الميزات عبر index.ts فقط
web/shared      ← لا يستورد من features
common (api)    ← لا يستورد من modules
```

**قاعدة إضافية:** المنطق المحاسبي (تكلفة، ربح، قسمة، زكاة) يُكتب في `packages/core` فقط. ممنوع تكراره في api أو web.

### 1.4 مصادر البحث

- [Scalable Folder Structures: NestJS, Nuxt.js and Next.js (DEV)](https://dev.to/actocodes/scalable-folder-structures-how-i-organized-nestjs-nuxtjs-and-nextjs-for-enterprise-projects-p8k)
- [How to Structure Your Next.js App Router Project for Scale (DEV)](https://dev.to/mahdi_benrhouma_fe1c6005/how-to-structure-your-nextjs-app-router-project-for-scale-4e3o)
- [Production Monorepo with Turborepo, Next.js and Shared Packages](https://noqta.tn/en/tutorials/turborepo-nextjs-monorepo-shared-packages-2026)

---

## 2. تعديل مهم على الترتيب

اتفقنا أن المزامنة تأتي في الآخر، لكن **أساس العمل بدون إنترنت يجب أن يوضع مع أول شريحة**: لو بنت الواجهة تقرأ من الخادم مباشرة، ثم أردنا لاحقاً جعلها offline، سنعيد كتابة كل الشاشات. لذلك:

- **الشريحة 1 (الكتالوج)** تبني قاعدة المتصفح (`local-db`) و**هيكل المزامنة العام** (outbox + push/pull) مرة واحدة.
- كل شريحة بعدها تسجّل كياناتها فيه فقط.
- **الشريحة الأخيرة من المرحلة الأولى** تُصلّب المزامنة (تعارضات، اختبار قطع الإنترنت، service worker).

---

# المرحلة 0: الأساس

## Prompt 0.1: فهم المشروع وكتابة CLAUDE.md

```
Read docs/PROJECT_SPEC.md fully. Do NOT write application code yet.

1. Reply with a 15-line summary of your understanding, and list any ambiguity or conflict you found in the spec.
2. Create CLAUDE.md at the repo root containing durable project rules:
   - Stack: pnpm monorepo + Turborepo, NestJS (apps/api), Next.js App Router PWA (apps/web), PostgreSQL, Docker, TypeScript strict everywhere.
   - Money = integer cents (amount_cents), lengths = integer cm. Users type/see decimals and rial/dirham; conversion only at the UI boundary (see SPEC section 0). 1 dirham = 20 rial = 100 cents.
   - All accounting logic lives ONLY in packages/core (pure functions, no I/O, 100% unit-tested). Never duplicate it in api or web.
   - Append-only: stock_move, payment, audit_log are never updated or deleted; corrections are compensating records. Use voided_at, never hard delete.
   - Folder rules and dependency directions from section 1.3 of docs/BUILD_PROMPTS.md.
   - Every table has: id (uuid), created_at, updated_at, device_id, voided_at.
   - UI is English (default, LTR) and Arabic (RTL), chosen per device (ADR 0008); user-facing strings go through i18n, added to both ar.ts and en.ts; never hardcode Arabic or English in components.
   - Definition of done: typecheck + lint + tests pass (make check), feature works offline, and docs updated.
   - Commands: make up, make down, make test, make check, make migrate, make backup.
   - Ask before assuming anything about accounting rules.
3. Create docs/adr/0001-stack.md recording the stack decision and docs/adr/0002-offline-first.md recording the local-first approach.
```

**كيف تتأكد:** ملخصه يطابق فهمك، وقائمة الغموض معقولة، وCLAUDE.md يحوي القواعد أعلاه.

## Prompt 0.2: هيكل الـ monorepo

```
Scaffold the monorepo exactly per the tree in docs/BUILD_PROMPTS.md section 1.2 (create folders and minimal configs only, no feature code).

- pnpm workspace (apps/*, packages/*), Turborepo (turbo.json with build/lint/typecheck/test/dev), Node LTS pinned (.nvmrc + engines), packageManager pinned.
- packages/config-ts (base, nest, next tsconfigs, strict), packages/config-eslint (flat config) with import-boundary rules enforcing section 1.3 (use eslint-plugin-boundaries, plus dependency-cruiser config and a `make deps` target).
- packages/core and packages/contracts as empty TypeScript packages with Vitest, built with tsup, exported via package.json "exports". Name them @fabric/core and @fabric/contracts.
- apps/api: NestJS minimal app with a /health endpoint. apps/web: Next.js (App Router, TypeScript, Tailwind) minimal home page, RTL (dir="rtl", lang="ar") and an Arabic font.
- Prettier + EditorConfig + commit hooks (lint-staged) for formatting.
- Make web transpile workspace packages correctly (transpilePackages).
Verify: pnpm install, pnpm turbo run build lint typecheck test all pass. Show me the final tree.
```

**كيف تتأكد:** `pnpm turbo run build` ينجح، وجرّب أن تستورد من `features` داخل `shared` عمداً ويجب أن يفشل lint.

## Prompt 0.3: Docker و Makefile و CI

```
Add Docker and automation.

- infra/docker/Dockerfile.api and Dockerfile.web (multi-stage, pnpm, non-root user, small final images, use turbo prune or pnpm deploy).
- infra/docker/compose.dev.yml: postgres:16 (named volume, healthcheck), api and web with hot reload and mounted source, pgAdmin optional behind a profile.
- infra/docker/compose.prod.yml: postgres (with volume), api, web, and a reverse proxy (Caddy or nginx) ready for HTTPS; secrets from env, never baked into images.
- .env.example with every variable documented; config validation in apps/api/src/config using zod (app fails fast if invalid).
- Makefile with: up, down, logs, build, test, check (lint+typecheck+test), migrate, migrate-new, seed, backup, restore, clean, deps. `make help` lists them.
- infra/scripts/backup.sh and restore.sh (pg_dump compressed, timestamped, rotation of the last 14), documented in docs/runbooks/backup.md.
- .github/workflows/ci.yml: install with cache, then turbo run lint typecheck test build; also a job that builds the Docker images.
Verify: `make up` starts everything, /health returns OK, `make check` passes, `make backup` creates a restorable dump (test restore into a scratch db).
```

**كيف تتأكد:** `make up` ثم افتح الصفحة الرئيسية. وجرّب `make backup` ثم `make restore`.

---

# المرحلة 1: النواة المحاسبية (packages/core)

> هذه أهم مرحلة. لا واجهة ولا قاعدة بيانات: دوال نقية واختبارات.

## Prompt 1.1: المال والطول والعرض بالريال

```
In packages/core implement value types and conversion (SPEC section 0, units).

- money: integer cents. Functions: fromDirham(decimal string|number) → cents, fromRial(rial) → cents (1 rial = 5 cents), toRial(cents), toDirham(cents), formatMoney(cents, unit: 'rial'|'dirham', locale 'ar'), parseMoneyInput(text, unit) which accepts decimals (20.5) and Arabic-Indic digits, rejects NaN/negatives where inappropriate.
- length: integer cm. fromMeters(2.75) → 275, toMeters, formatLength(cm) ("2.75 م"), parseLengthInput.
- Never use floating point for stored values; parse decimal strings safely (no 0.1+0.2 issues). Add rounding helpers with explicit half-up rule.
- Basis points helper for percentages (bp).
Write exhaustive Vitest tests, including: 20.5 dirham = 410 rial = 2050 cents; 43.478... rounding; Arabic digits input; very large values; invalid inputs.
```

## Prompt 1.2: تكلفة الرول والشراء (T1–T4)

```
In packages/core/costing implement roll creation and cost allocation per SPEC sections 2.3 and 2.4.

- buildRollsFromPurchase(input): supports method 'meter' (one purchase → N rolls, one per color, each with length and cost), 'piece' (single roll, e.g. 2.3 m for 100 dirham), and 'kg' (weight + price + estimated length from est_cm_per_kg, flagged lengthEstimated).
- allocateLineCost(roll, soldCm, previousLineCostsCents): round(costTotal * soldCm / lengthInitial), and when the roll is fully consumed the last line takes the exact remainder so totals never drift.
- applyLengthCorrection(roll, newLengthCm): returns new cost basis and the list of affected prior lines to recompute (only for non-locked periods).
- remainingLength(rollInitial, moves[]).
Implement tests T1, T2, T3, T4 and T12 from SPEC section 16 verbatim, plus property-based tests (fast-check): for any sequence of sales that exhausts a roll, sum of line costs === cost_total exactly.
```

## Prompt 1.3: التسعير والتفاوض وأجزاء الدين (T5, T8, T11)

```
In packages/core/pricing and packages/core/payments implement:

- computeSaleLine(roll, soldCm, actualPricePerMCents, refPricePerMCents, minPricePerMCents): lineTotal, lineCost, profit, warnings[] ('below_min_price', 'below_cost' requiring explicit confirmation).
- splitSaleCapitalProfit(sale): capital_part = sum lineCost, profit_part = total - capital_part (may be negative).
- allocatePayment(sale, paymentsSoFar, newPayment): capital-first then profit (SPEC 8.2), returns recovered capital and recognized profit per payment, never exceeding totals.
- customerBalance(sales, payments).
Tests T5, T8, T11 verbatim plus edge cases: overpayment, zero-profit sale, negative-profit sale, partial payments across many invoices, payment spanning two invoices.
```

## Prompt 1.4: التسوية الشهرية (T6, T7, T9, T10)

```
In packages/core/settlement implement computeSettlement per SPEC section 8.

Inputs: period recognized profit (from payment allocations), losses (loss moves + bad debts + below-cost portion), paid expenses, carried deficit, split rule (basis points, default 3333/3333/3334), partners' ownership.
Outputs: net profit, owner/partner/shop shares (remainder cents go to shop), carry_deficit_out, capital_moves to create (shop share split by ownership as retained_profit), and a human-readable breakdown.
Tests T6, T7, T9, T10 verbatim plus: net exactly 0, one cent, negative with carry, split rules changing mid-history (effective_from), ownership not 50/50.
```

## Prompt 1.5: ميزان الأمانة والزكاة (T13, T14)

```
In packages/core/integrity implement checkIntegrity(state) per SPEC section 9: cash + stock at cost + unrecovered capital in receivables must equal contributed capital + retained profit + undrawn partner balances + unsettled net profit. Return { ok, diffCents, breakdown }.
Also provide a deterministic scenario builder for tests (sequence of events: purchase, cash sale, credit sale, payment, expense, loss, draw, settlement) and assert the check passes for many random but valid sequences (fast-check) and FAILS when a single event is corrupted.

In packages/core/zakat implement computeZakat(snapshot, settings) per SPEC section 10 (base, nisab from gold price, hawl flag, 2.5%), with T14 and settings variations (valuation by selling price vs cost, doubtful debts excluded, silver nisab). Add a prominent doc comment: this is a calculation tool, not a fatwa.
Then run the whole core test suite with coverage; core must be >= 95% line coverage.
```

**كيف تتأكد من المرحلة 1:** `pnpm --filter @fabric/core test --coverage` أخضر، وراجع بنفسك T6 وT8 بآلة حاسبة.

---

# المرحلة 2: أساس الـ API

## Prompt 2.1: قاعدة البيانات والأساس المشترك

```
Set up the API foundation in apps/api.

- Prisma (or Drizzle: pick one, write ADR 0003 explaining why) with Postgres; migrations committed. Base columns on every table: id uuid (client-generated allowed), created_at, updated_at, device_id, voided_at, plus server_seq (bigserial, monotonically increasing, used by sync later).
- Money columns as integer cents (bigint), lengths integer cm.
- common/: global validation pipe using zod schemas from @fabric/contracts (nestjs-zod or equivalent), exception filter with consistent error shape, request-id logging (pino), OpenAPI docs at /docs.
- auth module: single owner account for now, password login with argon2, JWT access + refresh, guard applied globally; design roles (owner, partner, cashier) in the schema but only enforce owner now.
- audit module: an interceptor that records before/after for mutating requests into audit_log (entity, id, action, before, after, reason, actor, at). Never exposes delete.
- settings module: key/value with effective_from.
- Integration tests with a real Postgres (testcontainers or the compose db). `make check` must pass.
```

**كيف تتأكد:** `/docs` يظهر، ولا يمكن الوصول بلا تسجيل دخول، وأي تعديل يظهر في `audit_log`.

---

# المرحلة 3: شرائح الميزات (المرحلة الأولى MVP)

> **قالب كل شريحة:** contracts (zod) ← migration ← module في api ← local-db schema ← feature في web ← اختبارات ← تجربة يدوية. في كل شريحة اطلب خطة أولاً.

## Prompt 3.1: الكتالوج + أساس العمل بدون إنترنت (أهم شريحة بنيوياً)

```
Slice 1: Catalog (fabric, variant, supplier) AND the offline-first foundation (ADR 0002).

Contracts: zod schemas for Fabric, Variant, Supplier and the generic sync envelope in packages/contracts:
  SyncOp { opId uuid, entity, entityId, kind: 'upsert'|'void'|'append', payload, deviceId, clientTs }.
API (modules/catalog + modules/sync): CRUD endpoints, and sync endpoints POST /sync/push (idempotent by opId, validates payload with the same zod schemas and core rules, assigns server_seq) and GET /sync/pull?since=<server_seq> (paged). Conflict rule for mutable entities: last write wins by (updated_at, deviceId) with the loser logged to a sync_conflict table; append-only entities are never overwritten.
Web: apps/web/src/local-db using Dexie (IndexedDB): tables mirroring entities, an outbox table, a sync engine (push outbox, pull changes, retry with backoff, online/offline detection), and a repository interface per entity so features never touch Dexie or fetch directly. A generic useLiveQuery hook.
Feature: web/features/catalog: list fabrics with search, add/edit fabric (name, type, ref price, min price, est_cm_per_kg, sellable_as_piece), add/remove variants (colors), suppliers. All reads/writes go through repositories (offline works). Prices typed in rial by default with the money display setting.
Also: PWA basics (manifest, icons placeholder, service worker via Serwist or next-pwa-equivalent that caches the app shell).
Tests: unit (repositories), API integration (push idempotency, pull paging), one Playwright test: go offline, add a fabric, go online, verify it reaches the server and appears on a second browser context.
```

**كيف تتأكد:** افتح التطبيق على الحاسوب والهاتف، أضف قماشاً وأنت دون إنترنت، ثم شغّل الإنترنت وانظر ظهوره على الجهاز الآخر.

## Prompt 3.2: الشراء ← الرولات

```
Slice 2: Purchasing → rolls, per SPEC sections 2.2, 2.3, 2.4.

Contracts: Purchase, Roll, StockMove.
API (modules/purchasing + modules/inventory): create purchase endpoint that uses @fabric/core buildRollsFromPurchase and persists purchase + rolls + stock_move(type purchase) atomically; server re-validates with the same core function.
Web feature purchasing: a "New purchase" screen with method tabs:
  - Meter: choose fabric, supplier, price per meter, then a grid of colors each with its length (supports a whole 10-color assortment in one purchase; roll length default 50 m editable).
  - Piece: fabric, length, total price (shows computed cost per meter live).
  - Kg: weight, price, estimated length from est_cm_per_kg, clearly marked "estimated".
Auto-generate short roll codes (R-0001…) unique per device-safe scheme (documented). Show a confirmation summary before saving. Warn when the new cost per meter is higher than the previous batch of the same fabric (SPEC 8.5).
Tests: T1, T2, T4 end to end through API and UI; offline creation then sync.
```

## Prompt 3.3: شاشة المخزون والتصحيحات

```
Slice 3: Inventory screens.

- Inventory list: fabric → colors → remaining meters (derived from stock moves), roll count, low-stock badge from variant threshold, search/filter, out-of-stock section.
- Roll details: history of moves, cost per meter, estimated flag.
- Actions: length correction after measuring a kg-purchased roll (SPEC 2.3, T4), record loss/damage (stock_move type loss with required reason; feeds losses in settlement), adjustment (stocktake) with reason, mark remnant.
- Derived values come from @fabric/core only. Everything append-only and offline-capable; void instead of delete.
Tests: T3, T4, T12 via UI/API; Playwright for length correction recalculating cost.
```

## Prompt 3.4: نقطة البيع POS

```
Slice 4: POS sales per SPEC sections 3 and 4.

Contracts: Sale, SaleLine. API (modules/sales): create sale validates with core computeSaleLine, splits across rolls when needed, writes stock_moves, returns warnings; server rejects below-cost sales unless confirmedBelowCost=true.
Web feature pos (optimised for a touch tablet at the till, usable on desktop and phone; redesigned after the first version: colour tiles, the invoice at the side, an on-screen keypad for lengths, prices and amounts):
  - pick fabric/color → enter length in meters (decimals ok) → app proposes the oldest roll that fits (editable) and splits automatically across rolls if needed.
  - price per meter prefilled with reference price in rial, editable; line shows profit only for the owner; warnings for below min price / below cost with explicit confirmation.
  - cart of multiple lines, optional discount, optional customer (can add quickly), paid now (cash) or credit with optional due date.
  - after saving: "share invoice" producing a clean Arabic text for WhatsApp (shop name, date, lines, total, paid, remaining) via the Web Share API / wa.me link.
  - sale to a piece-sellable roll as a whole piece at piece price.
  - void sale (reverses stock via compensating moves, requires reason, logged).
Tests: T5, T11 plus Playwright scenario: sell across two rolls, negotiate price, share invoice, go offline mid-sale and complete it.
```

## Prompt 3.5: الزبائن والديون والدفعات

```
Slice 5: Customers, credit and payments per SPEC 4.1 and 8.2.

API (modules/customers): customers, payments (append-only), debt summary query. Payment can target an invoice or be general (auto-allocated to oldest unpaid invoices using @fabric/core allocatePayment).
Web feature customers: list with balance and age of debt, customer page (invoices, payments), add payment (full/partial), "who owes me" screen sorted by oldest/ largest, share a statement via WhatsApp text, write-off of bad debt (requires reason, recorded as loss).
Tests: T8 via UI/API; balance always equals sum(sales) - sum(payments); overpayment handling.
```

## Prompt 3.6: تصليب المزامنة والنشر (نهاية MVP)

```
Slice 6: harden offline/sync and ship the MVP.

- Sync hardening: conflict log screen (read-only list of sync_conflict), idempotency checks, large backlog handling (batching), clock-skew tolerance (use server_seq not timestamps for ordering), detection of two devices selling from the same roll offline (flag 'negative remaining' for review rather than blocking).
- Offline UX: persistent banner when offline/pending ops count, manual "sync now", safe behaviour on app update (schema versioning and Dexie migrations).
- Data safety: full JSON/CSV export from the settings screen, "restore from export" documented, automated nightly pg backup in compose.prod via cron container.
- Deployment: docs/runbooks/deploy.md for a small VPS (Docker, compose.prod, HTTPS via Caddy, firewall, non-root, automatic restarts, log rotation) and a rollback procedure.
- Playwright suite: two browser contexts, airplane-mode scenarios, concurrent edits, reconnect.
- Final MVP acceptance checklist in docs/MVP_ACCEPTANCE.md reproducing a full shop day: purchase assortment, sell with negotiation, credit sale, partial payment, loss, stock count.
```

**معيار قبول MVP:** تشغّل المحل يوماً كاملاً عليه (وعلى ورقتك القديمة بالتوازي)، والأرقام تتطابق.

---

# المرحلة 4: المالية والشراكة

## Prompt 4.1: المصروفات

```
Slice 7: Expenses per SPEC section 5. Module + feature: expense CRUD (void, not delete), categories (settings-driven), paid/unpaid, monthly list and totals; recurring templates with due-day reminders (in-app notification list shown on the home screen, and a "create from template" action with editable amount for variable bills such as electricity).
Tests: recurring creation, totals per month, offline.
```

## Prompt 4.2: الشركاء ورأس المال والسحوبات

```
Slice 8: Partners per SPEC 6, 7, 8.4. Module + feature: partners (owner + one partner, ownership bp), initial capital contributions, partner_draw records with reason, per-partner account page (capital, retained profit, undrawn share, draws). Cash drawer movements derived consistently with core. Permissions groundwork: role 'partner' can read, cannot edit.
Tests: balances derived from moves only; no negative-capital surprises without a warning.
```

## Prompt 4.3: التسوية الشهرية

```
Slice 9: Monthly settlement per SPEC 8 (uses @fabric/core computeSettlement only).
Feature: "Settlement" screen: pick period, system gathers recognized profit (via payment allocations), losses, paid expenses, carried deficit; shows a full breakdown and a PREVIEW; on approval it creates the settlement, capital_moves (retained profit split by ownership), partner balance entries, and LOCKS the period (no edits to records inside it without an explicit unlock action that is audit-logged with a reason).
Add profit_split_rule history with effective_from (default 1/3 each), editable only for future periods.
Tests: T6, T7, T9, T10 end to end including carried deficit across two periods and lock enforcement.
```

## Prompt 4.4: ميزان الأمانة والجرد النقدي وسجل التعديلات

```
Slice 10: Integrity and audit UX.
- Integrity screen using core checkIntegrity: shows OK/diff with breakdown and the last events that may explain a difference.
- Cash count: enter the physical cash, record cash_adjustment with difference and reason.
- Audit log viewer: filter by entity/user/date, shows before/after diffs; voided records visible with reason.
- Period lock rules surfaced in UI (why can't I edit this?).
Tests: T13 end to end; deliberately corrupt a record in test and see the diff.
```

---

# المرحلة 5: التوسع

## Prompt 5.1: الزكاة

```
Slice 11: Zakat per SPEC section 10, using core computeZakat only.
Settings screen for all zakat options (valuation basis, merchant type, nisab basis, gold price input with date, hawl date using the Hijri calendar via Intl or a vetted library), annual reminder two weeks before hawl, report screen listing every base item with source records, the result vs nisab, saving the report with a settings snapshot, recording payment of zakat as a deduction from the two partners' accounts by ownership, shareable text/PDF. Add a visible note that settings should follow the user's chosen scholarly opinion.
Tests: T14 and settings variations.
```

## Prompt 5.2: التقارير

```
Slice 12: Reports (owner only): profit by period, by fabric and color, best sellers and slow-moving stock (days since last sale), negotiation analysis (average discount vs reference price per customer/fabric), expense breakdown, receivables ageing, stock value at cost and at selling price, cash flow. Charts that read clearly in Arabic RTL. Computations in core where they are accounting logic; SQL/aggregations for pure reporting. Add CSV export per report.
```

## Prompt 5.3: الإرجاع وديون الموردين والصلاحيات

```
Slice 13: Returns (restore stock to roll or mark remnant, refund or reduce debt, reverse profit recognition proportionally), supplier payables (purchase paid_cents vs total, supplier statement, effect on integrity check and zakat base), roles (owner, partner read-only, cashier without cost/profit visibility enforced on the API not only the UI). Update SPEC and tests accordingly; extend checkIntegrity to include payables.
```

---

# أوامر عامة تستخدمها بين الشرائح

**مراجعة الجودة بعد كل شريحة:**

```
Review the changes of this slice against docs/PROJECT_SPEC.md and CLAUDE.md. List any violation of: dependency rules, accounting logic outside packages/core, floating point money/length, missing audit/void behavior, missing offline behavior, missing tests. Fix what you find, then run make check.
```

**عند اكتشاف خطأ محاسبي:**

```
We found an accounting bug: <describe with numbers>. First write a failing test in packages/core that reproduces it, then fix the logic, then check every place that duplicated it (there should be none). Run make check.
```

**قبل كل إصدار:**

```
Run the full checklist: make check, Playwright suite, integrity check on the seeded demo data, backup+restore test into a scratch database, and update docs/runbooks and the CHANGELOG. Report anything failing.
```
