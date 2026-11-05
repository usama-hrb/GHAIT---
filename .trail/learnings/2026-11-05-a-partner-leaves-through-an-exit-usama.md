---
title: 'A partner leaves through an exit mark plus ordinary payout records, never a delete'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 0 }
id: l-97c0d0f8
scope: repo
status: active
src: agent
touches:
  - apps/web/src/local-db/partners.ts
  - apps/api/src/modules/partners/partners.repositories.ts
  - docs/accounting-assumptions.md
  - docs/adr/0022-people-partners-and-salaries.md
---

## Decided

- Partner exit is one mark on the partner record (an exit day and an optional note) plus the ordinary records the shop already has: a capital withdrawal for capital paid back, a profit draw for undrawn profit paid out, an ownership change to the owner, and profit split rule changes. We chose this over an exit table or a stored status column because balances are derived from movements and the standing (active, leaving, former) is derived from the exit day and the current date. A second place saying "this partner is gone" could disagree with the movements. Both new columns are nullable, so old backups, exports and devices keep working.
- The exit mark is written last, inside the same local transaction as the payouts, and the server re-checks it on arrival (the partner owns nothing, and no rule gives them a share from the day they leave). If any record fails, the partner stays active and nothing is half done.
- The profit-split change for a leaver starts on the exit day, or on the day after the current date when the exit day is earlier, because rule S15 refuses a rule that starts on or before the current date. Settled periods keep the split they were settled with. Months before the exit day that are not settled yet still share profit under the old rule (S3).
- Ownership moves immediately, with no effective date, because the data model gives ownership no date.
- Payments are recorded when the owner confirms the final summary, not one by one, so there is exactly one confirm and a ref guard stops a double tap from recording a payment twice.
- A partner who took part in nothing is still removed by voiding with a reason (the "added by mistake" path). A partner with any money record can only exit.

## Tried and ruled out

- A confirmation per payment in the middle of the flow: it made the owner confirm money twice and allowed a half-finished exit if the tablet went offline between the two.
- A payment method field and an expected payment date field: the data model has neither, and adding them needs a migration and an accounting decision from the owner, so they are listed in S21 instead of being guessed.
- Proving settled-period cases (profit partly paid, fully drawn, a failed payment rolling back) in Playwright: creating allocated profit there locks a month that other specs share in the same database. The local-db unit tests and the API integration tests cover those cases.

## Watch out

- The preview of a leaver's profit share must read the earliest rule that names them (`shareFrom`), not the day the change starts, or a share that only begins in a later rule shows as 0%.
- The section list opens the first section that needs a decision by itself and moves on after each decision. An e2e step that clicks a section header must check `aria-expanded` first, or the click closes the section it meant to open.
- Playwright specs share one database and run in file name order, so `partner-exit.spec.ts` runs before `partners.spec.ts`. Never hard-code figures that depend on earlier cash, and make shop set-up steps tolerate a shop that already exists.
- Piping a Playwright run into `head` kills it with SIGPIPE. Use `grep` or `tail`, and delete `apps/web/test-results` and `playwright-report` afterwards.
- A device on a build from before the exit existed saves a partner without the exit day, and the server reads that as bringing the partner back (S21 point e). The REST route `putPartner` keeps the exit day, the sync path does not.

In the code: `packages/contracts/src/partner-exit.ts` (`checkPartnerExit`, `exitRuleChanges`, `exitRuleDate`, `partnerStandingOf`), `apps/web/src/local-db/partners.ts` (`completeExit`, `reactivate`), `apps/web/src/features/partners/partner-exit-center.tsx`, `apps/api/src/modules/partners/partners.repositories.ts`, `docs/accounting-assumptions.md` rows S20 and S21, `docs/adr/0022-people-partners-and-salaries.md`.
