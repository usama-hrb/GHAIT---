# ADR 0005: Monthly settlement and the period lock

- Status: Accepted
- Date: 2026-10-31

## Context

BUILD_PROMPTS 4.3: a settlement screen that previews a period, then on approval creates the settlement, the retained-profit capital moves and the partners' balance entries, and **locks** the period: no record inside it changes without an explicit, audited unlock. The accounting rules are in `docs/accounting-assumptions.md` (S7–S16); this records how the system enforces them.

Three facts shape it:

- A settlement must count **every device's** records. A device offline for a day knows only its own; only the server has them all once devices sync (ADR 0002).
- Records are written through one path on the server: `SyncService` applies device ops (append, upsert, void) and the REST writes (`appendDirect`, `saveDirect`, `voidDirect`). Every dated record goes through it.
- Costs are derived (P9, R1): a measurement re-costs a roll's earlier sales. A settled month must not move when a roll is measured later.

## Decision

### Approving and unlocking are server operations

`POST /settlements` and `POST /settlements/:id/unlock`, online only. The server gathers the period from its own records (`previewSettlement` in `@fabric/contracts`, on top of core `periodResultOf` and `computeSettlement`), and writes in one transaction: the `settlement` row, a `settlement_share` per partner, the `retained_profit` capital moves (`settlement_id` set), and the frozen costs (`locked_cost`). Unlocking voids all of them. Each writes one audit entry with the settlement and what it created (the frozen costs as a count); an unlock carries the reason.

The device previews offline from its own records with the same function. To approve, it syncs, shows the **server's** preview, and sends back the breakdown the owner confirmed (`expected`): if records arrived since, the server answers 409 `settlement_preview_changed` and the owner looks again. The device never computes a settlement the server would not.

Devices receive the results through sync: `settlement`, `settlement_share` and `locked_cost` are `pull_only` entities.

### The lock is a guard on SyncService

`SyncRegistry.setPeriodGuard` takes one guard, registered by the settlements module (`PeriodLock`). Before writing, `SyncService` asks it about the dates the change is accounted on: `periodDatesOf(entity, payload)` from `@fabric/contracts`, or the handler's own `periodDates` when the payload does not say (a sale void is dated by its sale too). Edits and voids are checked on the current record and the new one. A locked date is a `SyncRejection('period_locked')`: a rejected op for a device, a 409 for REST.

The same contracts functions run on the device (`LocalStore.assertPeriodOpen`), so a locked date is refused there first, with the reason. The server's check is the one that counts: a device may not have pulled the settlement yet.

A record made offline before the settlement and pushed after it is refused, not moved into the open period (S12): it stays on its device as a rejected op, and the owner unlocks the period to enter it again.

### Writes and approvals are serialized by an advisory lock

Every dated write takes `pg_advisory_xact_lock_shared(4300)` before it reads the last settled day; approving and unlocking take `pg_advisory_xact_lock(4300)`. Both are held to the end of the transaction. A write can therefore never be accepted into a period while that period is being settled and miss the settlement: either it commits before the approval reads the records, or it waits and then sees the lock. Shared locks do not wait for each other, so ordinary writes are not slowed.

Partial unique indexes back this up: one live settlement per period end, one live split rule per date, one live frozen cost per stock move.

### Frozen costs

`locked_cost` keeps the cost of each sale and loss move a settlement counted. `rollLedgerOf` takes moves with `lockedCostCents` (`withLockedCosts`), so every ledger, on the server (`InventoryService.histories`, roll detail) and on the device (`withFrozenCosts`), costs a roll the same way, and pricing a new sale agrees on both sides.

### The default split rule is not a record

Equal thirds apply from `2000-01-01` (`DEFAULT_SPLIT_RULE`). Entered rules start after today, so a real rule never collides with it, and an empty database (`make import`) has no seeded row to clash with an export.

## Consequences

- Approving needs a connection; everything else on the screen works offline (preview, history, split rules, which sync as a mutable entity).
- A zakat report (BUILD_PROMPTS 5.1) is the one dated entity left out on purpose: a snapshot, not a record of the books (accounting-assumptions Z10); its payments are draws, which are locked.
- A new dated entity must be listed in `periodDatesOf`, or give its handler a `periodDates`; otherwise nothing locks it. Tests cover a pushed sale, a sale void, expenses and retained profit on the server, and sales, voids, expenses and stock moves on the device.
- The lock is enforced in the application, not by database triggers: the dates of a sale void or an expense need lookups and rules (an unpaid expense is in no period) that would duplicate contracts code in SQL.
- An offline record refused by a lock must be entered again after unlocking: the sync issues screen shows it, but cannot retry it yet.

## Sources

- Odoo's lock dates and Xero's lock dates: closing a period refuses entries dated in it until an adviser unlocks it.
- PostgreSQL advisory locks (shared and exclusive, transaction-scoped): https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS
