# ADR 0006: The integrity check, cash counts and the audit log on devices

- Status: Accepted
- Date: 2026-10-31

## Context

BUILD_PROMPTS 4.4: an integrity screen (SPEC §9, core `checkIntegrity`), cash counts, an audit log viewer, and the period lock shown where it stops an edit. The offline rule (ADR 0002) says a screen that only works online is a bug. Each of the four has a different relation to the server.

## Decision

### The integrity check runs where the records are

`integrityReportOf` (`@fabric/contracts`) derives every amount of the check from the records with core functions: cash with `cashFlowsOf`, stock at cost from each roll's ledger (frozen costs kept), receivables, capital, partner balances, and the unsettled net profit with the same `periodBasisOf` the settlement uses. The device runs it on its own records, offline; the server runs it on everyone's (`GET /integrity`). They give the same answer once the device has synced. A difference on one device only means it has not synced, or the server refused one of its changes.

The screen lists the latest changes (sales, payments, expenses, stock moves, counts, settlements…) from the device's records, with links: where a difference usually comes from.

### Cash counts are offline records

`cash_adjustment` is a mutable synced entity, created or voided, never edited (`checkUnchanged`, as capital moves). The device records a count against its own books (`expected_cents`) and stores the difference; the server checks the arithmetic and the reason, not the expected figure (accounting-assumptions I6). The period lock covers it (`periodDatesOf`). A count made over REST is recorded against the server's books.

### The audit log is read from the server

`audit_log` is the server's record of what it applied. It is not synced: every change of every device with before and after snapshots would make each device carry the shop's whole history, and a fresh phone pull all of it. The viewer reads `GET /audit` (filters: entity, account, days in the shop's time zone; actor names joined in) and keeps the first page of the last ten searches on the device, shown offline with the time they were fetched. A device's own unsynced changes are not in the server's log yet; they are in its outbox (the sync status and issues screens).

### The lock is shown where it stops an edit

The settlements feature exports `useLockedThrough`, `isLockedOn`, `PeriodLockHint` (under a date field: "this date is in a settled period, until …; unlock it on the settlement page") and `LockedBadge` (in a list, instead of the edit and void actions). The decision is still `periodLockIssues` from `@fabric/contracts`, the function the repositories and the server apply.

## Consequences

- The integrity screen, counts and lock hints work offline; the audit log offline shows only what was fetched before.
- Each screen that edits dated records shows the lock through these components: expenses, sale detail, partner account, cash counts, and the purchase, expense, partner-money and count forms. A new one should use them too.
