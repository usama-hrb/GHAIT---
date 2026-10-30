# ADR 0002: Offline-first data and sync

- Status: Accepted
- Date: 2026-10-29

## Context

SPEC §0.5 and §12.1 are binding:

- Every operation (sale, purchase, payment…) runs immediately against a local database on the device, with no internet.
- Sync runs in the background, both ways: desktop ↔ server ↔ phone.
- UUIDs for every id; no sequential ids.
- Stock is a log of movements (`stock_move`), not an edited number.
- Records carry `updated_at` and `device_id`. Merge policy: movements are unioned; mutable entities are last-write-wins with the conflict logged.
- Usually one selling device, so conflicts are rare. If the same remaining length is sold from two offline devices, it is flagged at sync, never blocked.

BUILD_PROMPTS §2: the offline foundation ships with the first slice (catalog). Screens built to read from the server would all have to be rewritten later to work offline.

## Decision

**Local database.** Each device keeps a full replica of the shop's data in IndexedDB through Dexie. One shop's data is small enough for a full replica.

**Reads.** The UI reads only from the local DB, through live queries. Features access data through per-entity repositories in `apps/web/src/local-db`; they never call Dexie or `fetch` directly.

**Writes.** A write is one local transaction that changes the entity and appends an op to an `outbox` table:

```ts
SyncOp { opId: uuid, entity, entityId, kind: 'upsert' | 'void' | 'append', payload, deviceId, clientTs }
```

Input is validated with `@fabric/contracts` and `@fabric/core` before commit, exactly as the server will.

**Ids.** All ids are client-generated UUIDs. Human codes (roll `R-0001`…) use a device-safe scheme defined in the purchasing slice.

**Push.** `POST /sync/push` sends outbox batches. Idempotent by `opId`: a replayed op is a no-op. The server re-validates each op with the same contracts and core rules, then assigns a monotonically increasing `server_seq`.

**Pull.** `GET /sync/pull?since=<server_seq>`, paged. Each device stores its cursor. Changes are ordered by `server_seq`, never by device clocks.

**Merge.**

- Append-only entities (`stock_move`, `payment`, `audit_log` and other movement records): union, never overwritten.
- Mutable entities (fabric, variant, customer, settings…): last write wins by (`updated_at`, `device_id`). The losing version is stored in `sync_conflict` and shown on a read-only conflict screen.
- A void is its own op (`kind: 'void'`), never a delete.

**Derived values.** Remaining length, balances and cash are computed from movements with `@fabric/core`. Merging the same movements gives the same result on every device and on the server.

**Stock conflicts.** If two offline devices consume the same roll and the merged movements make its remaining length negative, the roll is flagged for review. The sale is never blocked or rejected.

**App shell.** A service worker (Serwist or equivalent) caches the app shell so the PWA opens with no network. Local schema changes go through versioned Dexie migrations.

**Server role.** Sync hub, second validator and backup (nightly `pg_dump`). A full JSON/CSV export is also available from the app.

**Phasing.** Slice 1 builds `local-db`, the outbox, the sync engine and push/pull. Each later slice only registers its entities. Slice 6 hardens it: batching, retry with backoff, conflict screen, offline banner and pending-op count, two-device Playwright tests.

## Implementation decisions (Slice 1, 2026-10-29)

- **Conflict detection.** An op carries `baseServerSeq`, the `server_seq` of the version it was made on. The server treats an upsert as concurrent only if the record changed since then and was last written by another device. A device's own consecutive edits never conflict. A non-concurrent edit applies even if its clock is behind, which limits clock-skew damage to real conflicts. Concurrent edits are decided by last write wins on (`updatedAt`, `deviceId`), and the losing version is stored in `sync_conflict`.
- **Voids are final.** Only a `void` op sets `voidedAt`. An upsert never clears it, so a late edit from another device cannot bring a cancelled record back.
- **One sequence, serialised writers.** `server_seq` comes from a single sequence and is bumped by trigger on every insert and update (a client cannot set it). Every write transaction first takes one advisory lock, so `server_seq` order equals commit order. A pull can then never move its cursor past a row that commits later with a smaller number. A shop's write rate makes the lock free.
- **Push.** Each op runs in its own transaction, with a savepoint around applying it. A rejected op is recorded (`sync_op`) and does not undo the others, and replaying an `opId` returns the first answer. Rejections stay in the device's outbox, marked and counted in the header, and are never retried as they are. A reference to a record the server does not have is rejected, not left half-applied.
- **Registry.** Each API module registers a `SyncHandler` for its entities. `@fabric/contracts` `SYNC_ENTITIES` lists every entity with its merge kind (`mutable`, `append_only`, `pull_only`) and its schema. The `append` path arrives with the first append-only entity (`stock_move`, Slice 2). Settings are `pull_only` for now: devices receive them, and the settings screen will add offline writes.
- **Device side.** A pulled record whose id has a pending op keeps its local version until the server has decided. Two sync runs never overlap: across tabs they are serialised by the Web Locks API, and so is token refresh, because two tabs rotating the same refresh token would look like token theft.
- **Offline routes.** Screens take record ids as query parameters (`/inventory/fabric?id=…`), not path segments, so one precached page serves every record offline. The service worker (Serwist for Turbopack) precaches the build and the shell pages, and never caches `/api`.
- **Same origin.** The web app always calls `/api`: Caddy in production, a Next rewrite (`API_PROXY_TARGET`) in development and end-to-end tests. The refresh cookie can stay `SameSite=Strict`.
- **Enforced.** Lint forbids Dexie, `indexedDB` and `fetch` outside `apps/web/src/local-db`. A Playwright test (`make e2e`) goes offline, adds a fabric, comes back online, checks the server and a second browser.

## Implementation decisions (Slice 2, 2026-10-30)

- **Aggregate ops.** A purchase is one `append` op whose payload is the purchase plus the rolls and `purchase` stock moves it creates (`purchaseAggregateSchema`). The server applies it atomically in the op's savepoint, and devices pull the three record types separately. `SYNC_ENTITIES` gives such an entity a `pushSchema` next to its record `schema`. Rolls and stock moves are `pull_only` until Slice 3 pushes moves of their own.
- **Re-checked with core.** Device and server build the records with the same `buildPurchaseAggregate` (`@fabric/contracts`, which calls `@fabric/core` `buildRollsFromPurchase`). The server rebuilds them from what was typed and rejects anything that differs, down to one cent or one move.
- **Device-safe roll codes.** Right after sign-in, each device gets a short code from the server (`POST /devices/register`: A, B…, then AA). It numbers rolls offline with a local counter: `R-A0001`, `R-B0001`. A device's codes never collide with another's, and a unique index on `roll.short_code` is the backstop: a clash would be a rejected op, visible to the user. A new browser profile is a new device with a new code.
- **Offline navigation.** The service worker ignores the `id` query parameter when matching the precache, so `/purchases/view?id=…` is served by the one precached `/purchases/view` page. Next's `?_rsc=` fetches still reach the network. After a save, a move to another page while offline is a full page load (served from the precache); Next's client navigation cannot fetch the new page's data offline. `useAppNavigation` in `shared/lib` does this.

## Implementation decisions (Slice 3, 2026-10-30)

- **Stock actions are moves.** A loss, a stocktake count and a measurement are each one `stock_move` sent as an `append` op. The device builds it with `buildStockMove` (`@fabric/contracts`) from what was typed and its own view of the roll. The server re-checks it against the roll's history with `checkStockMove`: allowed type, roll, sign, reason, and a basis length of at least 1 cm. `purchase` and `sale` moves only arrive inside their purchase or sale.
- **Derived, never stored.** A move carries a length, never a cost. The cost of each loss (later each sale) and the roll's remaining length, cost per metre, stock value and "estimated" flag all come from replaying the roll's moves through `@fabric/core` `rollLedger`. The replay goes in creation order (`createdAt`, then id), the same on every device and on the server. So a measurement re-costs the rest of the roll without editing an append-only row. The roll state (active, remnant, empty) is derived too, from the remaining length, the `remnant_threshold_cm` setting and the manual remnant mark.
- **Rolls stay fixed.** A roll is `mutable` in `SYNC_ENTITIES`, but only so its remnant mark can sync. `checkRollUpdate` refuses any other change, and a roll cannot be voided: a mistaken purchase is undone with compensating moves.
- **Measurement input.** The user enters the length on the roll now, not its original length. The new basis is basis − remaining + measured (SPEC §2.3), so what was sold or lost stays sold. A measurement of a roll bought by weight also updates the fabric's `est_cm_per_kg` (C11), as an ordinary fabric upsert.
- **No reload on reconnect.** The service worker provider's `reloadOnOnline` is off. A reload would discard a form being filled in, and sync already resumes on the `online` event. The Playwright run found the problem: Chromium can fire a stray `online` right after `offline`, and the reload cancelled a navigation.
- **Known limitation.** A stocktake or a measurement records a difference computed from the device's own view of the roll. If two devices count or measure the same roll while one is offline, both differences apply and the roll is corrected twice. The history shows both moves, and another count fixes it. This is rare with one till and one phone, and is revisited with the conflict screen in Slice 6.

## Implementation decisions (Slice 4, 2026-10-30)

- **One op per sale.** A sale is an `append` op carrying the sale, a line and a `sale` stock move per roll, and the cash paid at the counter as a payment with its allocation (`saleAggregateSchema`). The device prices it with `priceSale` (`@fabric/contracts`, which calls `@fabric/core` `computeSaleLine` and `splitSaleCapitalProfit`). The server prices it again on its own view of the rolls (`checkSaleAggregate`). Lines, payments and allocations are `pull_only`: they only arrive inside their sale.
- **What the server re-checks.** Totals, lines, moves and the payment must be exactly what was typed would give. Costs are not compared: another device's sale of the same roll may have reached the server first, and costs are derived anyway (P9). The one cost-dependent rule, the confirmation under cost (P8), is applied on the server's figures.
- **Voids are their own records.** Voiding a sale is a `sale_void` append op with a `reversal` move per line and the refund. The server stores them and sets the sale's `voidedAt` in the same transaction, audited with the reason. `sale_void.sale_id` is unique, so two devices voiding the same sale offline give one void and one rejected op.
- **Customers** are a `mutable` entity. A customer added at the POS is queued before the sale that names them, so the server has them first.
- **Order of a sale's lines.** The server keeps them in insertion order (`server_seq`). The device shows them by id until they sync.

## Implementation decisions (Slice 5, 2026-10-30)

- **Receivables module.** Payments, allocations and write-offs live in their own API module (`receivables`, storage only). Sales writes the counter's payment and the void's refund through it; customers adds the checks, the account and the debt summary. So sales and customers never depend on each other.
- **Ops.** A customer's payment or refund is one `payment` append op with its allocations (`paymentAggregateSchema`). Applying a credit is a `payment_allocation` append op carrying allocations of earlier payments. A write-off is a `write_off` append op.
- **Allocations are checked, not recomputed.** How a payment is spread over invoices depends on what the device knew, and two devices offline may both pay the oldest invoice. The server checks that each allocation pays a sale of the payment's customer and that no payment is applied beyond its amount (`checkAllocations`). Any spread keeps the customer's balance right, since balance = Σ sales − Σ payments + Σ refunds. An invoice that ends up overpaid simply has a negative due, which counts as credit.
- **Write-offs** are unique per sale, so two devices writing off the same invoice give one write-off and one rejected op.

## Implementation decisions (Slice 6, 2026-10-30)

- **History order ignores device clocks.** A roll's moves, and a sale's payments, are taken in `server_seq` order: what the server received, in the order it received it. Moves only on the device come after, in the order they were made there (`syncOrder`, `@fabric/contracts`). A device whose clock is wrong can no longer reorder another device's history, and the device's own view matches what the server will have once it pushes.
- **Clocks ahead are capped.** A pushed record's `updatedAt` is stored at most 5 minutes after the server received it. A device with its clock set ahead cannot win every later last-write-wins conflict. The device gets the stored value back on its next pull.
- **Restore epochs.** `server_instance` has one row per data set: the migrations add the first, and every restore (`make restore` into the app database, `make import`) adds a new one. Each pull reports the current epoch. A device that sees a new one pulls everything again from 0: its cursor pointed into data that no longer exists, and after a restore the sequence starts again below it.
- **Conflict log on every device.** `sync_conflict` is `pull_only`, so the read-only conflict screen (Settings → sync issues) works offline. The same screen lists the changes the server refused and the rolls sold beyond their length (remaining < 0 or `oversold`). Those rolls are flagged for review, never blocked: both sales stand, and a measurement or a count corrects the roll.
- **App updates.** The service worker takes over at once (`skipWaiting`). An open page shows a "new version" notice with a reload button. When the new code opens the database at a newer Dexie version, older tabs close it and reload (`versionchange`). Nothing is lost: every change is already in IndexedDB and its outbox.
- **Export.** Each device holds the whole shop, so its export (Settings, JSON) has the same shape as the server's (`make export`, `dataExportSchema`). Either one rebuilds an empty server with `make import`.

Open question 1 is answered: `server_seq` plus `baseServerSeq` covers what a `version` field would, so there is none.

## Alternatives considered

- **Online-first with a cache.** Rejected: violates SPEC §12.1.1.
- **PowerSync or ElectricSQL.** Replicates Postgres to the client with less code to write, but was not chosen with the stack (ADR 0001) and would move merge behaviour out of our code.
- **SQLite via WASM (wa-sqlite on OPFS).** SQL on the device, but a bigger bundle and persistence that behaves differently across mobile browsers. Dexie is simpler and enough at this data size.
- **CRDTs (Automerge, Yjs).** Overkill: most data is append-only, and conflicts on mutable entities are rare.

## Consequences

- Every feature is designed for offline from the start; "works offline" is part of the definition of done.
- Business validation runs on the device and on the server from the same packages, so the two cannot drift.
- The server can reject an op that is already committed on the device (for example, a device on an old app version). Rejections must be visible to the user, never silently dropped; the handling is designed in Slice 1.
- Last-write-wins uses device clocks for mutable entities, so clock skew can pick the wrong winner. Acceptable because conflicts are rare and every loser is logged; clocks set ahead are capped (Slice 6).
- Period locking is eventually consistent: a device that was offline while a period was locked elsewhere can write into it. The server must detect this on push.
- The browser can evict or the user can clear IndexedDB. Mitigations: request persistent storage (`navigator.storage.persist()`), sync often so the outbox stays small, server backups and app export.
- The schema evolves in three places (Postgres migrations, contracts, Dexie versions); each slice changes them together.

## Open questions (owner to decide)

1. ~~SPEC §12.1.6 also names a `version` field per record; is it needed next to `server_seq` and `updated_at`?~~ No (see above).
2. Policy for writes that land in a period locked on another device: reject, accept and flag, or accept into the next open period?
