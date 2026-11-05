# ADR 0022: People — several partners, employees and salaries

Status: accepted. Two additive migrations (`0031_people_and_salaries.sql`, and
`0032_partner_exit.sql` for the partner exit), new contracts and core functions, two new synced
entities. The rules this records are rows S17, S18, S19, S20, S21 and PY1–PY6 in
`accounting-assumptions.md`, and S1, S2, S4, S15 and Z7 as amended.

## Context

The Partners page assumed a shop of exactly two participants: the owner and one partner, a profit
split of three weights (owner, partner, shop), and a server that refused a third partner (S4).
The owner's shop has more than one partner, and also employees who are paid a monthly salary. Three
needs followed:

1. Any number of partners, each with a share of the profit, a capital account and draws, and a
   history that is never rewritten when someone joins.
2. Employees, who are not partners: they take no part of the profit and hold no capital.
3. Salaries, recorded and visible per employee (due, paid, still owed), without a second accounting
   path next to expenses.

The settlement itself (ADR 0005, ADR 0021) must not change in what it computes for a shop that
does not use any of this: T1–T16 still pass verbatim.

## Decision

### Several partners are an N-way split in `@fabric/core`

`splitNetProfit` splits the net profit once, by weights, among the owner, every partner and the
shop (S17). The order is fixed (the owner, the partners by id, the shop) so every device and the
server give the same odd cent to the same person; the division cents still go to the shop (S1). The
shop's retained share is split among the owner and the partners by ownership with the largest
remainder (S2). With one partner the result is the one it was before, which the existing tests
pin.

A rule keeps its three columns and gains `partner_weights`, a nullable jsonb array of
`{partnerId, weight}`. A row written before (null) is read as the shop's first partner's weight, so
a partner who joins later is outside every period already settled and outside the default rule.
Nothing is backfilled and nothing in a settled period is touched (SW5). A partner is given a share
by a new rule dated after today (S15); the partner dialog does this for the owner and shows the
split that will result before saving.

A partner's status (active or inactive) is derived from ownership and the rules (S18); it is not a
field. A partner who leaves has their ownership and weight taken to 0, and their account and the
settled history stay. Amended on 2026-11-05 at the owner's request: such a partner can then be
removed (S19). Removal is a void with a reason, never a delete, and only a partner with no
ownership, no money records and no profit weight can be removed; `checkPartnerVoid` in
`@fabric/contracts` is run on the device and again on the server.

### A partner leaves through the Partner Exit Center

Removal (S19) is only for a partner who took part in nothing. A partner with a history leaves
through the Partner Exit Center, a guided dialog opened from the partner's menu with "Start
partner exit" (S20). It shows what they are owed and what they hold, asks what to do about the
profit owed, the capital, their ownership and their profit share, and writes everything only after
a review in plain words. Choosing prepares an action; nothing is recorded until "Complete partner
exit".

The partner is marked rather than removed. `partner.exited_on` (a date) and `partner.exit_note`
(text) are the only new columns, both nullable. A stored date is used and not a derived status,
because the day they leave cannot be worked out from anything else: ownership and rules can be
zero for a partner who is still in the shop, and a future departure date has to be remembered.
Standing is then derived from that date and today (`partnerStandingOf`: active, leaving, former),
and S18's derived status is not changed. Migration 0032 adds the two nullable columns, so an old
database, an old backup and an old device export read as "never exited". A device still running
a build from before this change writes a partner without the two fields, and the server reads
that as "not exited", the same as bringing the partner back (S21, point e). The new web build
keeps the two fields on every partner save, so only a device that has not updated can do it.

The exit is written as ordinary records: a profit draw for the profit paid, a capital withdrawal
for the capital repaid, ownership rows moved to the owner or to partners who stay, profit rules
from the exit date through `exitRuleChanges`, and last the exit mark. On the device these run in
one transaction, so a failure leaves nothing; on the server each record is checked when it
syncs, and a device whose balances are out of date is refused. No new accounting rule lives in the
screens. The checks are in `@fabric/contracts` (`partner-exit.ts`), the rule changes reuse the
settlement's weights, and the screen only turns choices into figures (`partner-exit-model.ts`).

### Partner writes: whole at the screen, record by record on the server

The server accepts a partner record when the total ownership would not exceed 100%
(`checkPartnerWrite`), so a shop is changed one record at a time. The Partners screen saves the
owner's table whole and refuses a total that is not exactly 100% (`checkPartnerSet`), and writes
the reductions before the increases so the server never sees more than 100% in between. Drafts
are full records (a partial one would overwrite the fields it left out).

### Employees are their own entity

`employee` (name, phone, position, start and end date, notes) and `employee_salary` (the monthly
rate, from the first day of a month). An employee never appears among the participants of a
settlement, in the profit split, in capital or in draws (PY1). They are listed under Settings →
People & Partners next to the partners, in their own tab, and open their own page.

Rates are created or voided, never edited (PY4), so a past month keeps the salary it was owed.
What a month owes is derived from the rates (PY2) and what it has been paid from the payments
(PY3): nothing about salaries is a stored balance.

### A salary payment is an ordinary expense

Paying a salary creates an expense in the `wages` category carrying `employee_id` and
`salary_month`, dated the day it is paid. It is therefore counted by its paid date (S6), locked with
its period (S11), audited, synced and listed in Expenses like any other. The settlement,
the integrity check and the cash figure read it as an expense: there is no salary arithmetic in
them (PY1).

A table constraint keeps the pair together (both columns or neither) and the booking honest (a salary
payment is `wages` with a paid date).

What is **owed** is not an expense and not cash: under the cash basis (S6), a salary due and not
yet paid is not in any period and does not change a settlement. It is shown on the People pages
(due, paid, owed per month, and the total owed). Paying it later puts it in the period of the day it
is paid. Voiding a payment makes the month owe it again.

### Offline first, and what the server re-checks

Employees, rates and payments are saved on the device first and synced like everything else. The
checks live in `@fabric/contracts` and `@fabric/core` (`checkSalaryRate`, `checkSalaryPayment`,
`checkEmployee`, `payrollOf`) and the API runs the same ones. A device that is offline judges a new
rate by the day it was typed, and the server accepts what it accepted then (PY4). The settlement
preview, which already runs from the device's expenses, includes a salary paid offline immediately.

### Roles

The owner changes people; a partner reads them; a cashier never receives them: the API answers
403 and the sync hub neither sends nor accepts `employee` and `employee_salary` (`CASHIER_ACCESS`,
PY5).

### Routing and screens

People & Partners stay under Settings (`/settings/partners`), with two tabs (partners, employees)
kept in the query string (`?tab=employees`; the service worker ignores `tab`). A partner has a page
(`/settings/partners/view?id=`) and so does an employee (`/settings/partners/employee?id=`).
Pages take the record as `?id=` and navigate with `useAppNavigation`, as every record page does.
`/partners` redirects.

## Alternatives rejected

- **A payroll module with its own payment table.** It would need its own period, lock, audit,
  sync and cash handling, and the settlement would have to learn a second source of outgoing
  money. Linking an expense to an employee reuses all of it and cannot be counted twice.
- **Accrual of unpaid salaries in the settlement.** The spec's basis is cash (S6) and an unpaid
  expense counts in no period. Changing the basis for one kind of expense would make the
  settlement disagree with the Expenses page. The owed amount is shown, not booked.
- **Proration and day-count rules.** Labour-law choices the spec does not make; PY2 says whole
  months, and a new rule can be added later without changing what is stored.
- **A payment method on a salary payment, and weekly or daily pay.** Not asked for; the model has
  room (an expense has fields) but nothing is recorded that nothing reads.
- **Salary as a partner draw.** It would put a cost into a partner's account and hide it from the
  period's expenses.
- **A stored partner status or a stored "owed" balance.** Either could disagree with the records.
- **A top-level Employees item in the sidebar.** Partners live under Settings (CLAUDE.md); the
  shop's people are one place.

## Consequences

- A database upgraded to this migration behaves exactly as before until a partner is added or an
  employee is paid: every new column is nullable, the two tables start empty.
- The first-run set-up appears when the shop has no partner at all and is the same dialog used
  to add one.
- `settlement.partner_weights` keeps the weights a settlement used, so an old settlement stays
  readable whatever rules come later.
- Employees and partners share a screen but not a model; the directory, the account and the
  salary history are different views of different records.
- A former partner stays in the directory under "Former partners" with their account page,
  their payment history and the same draw and capital withdrawal buttons, so what is still owed to
  them can be paid later. They are left out of the ownership table and the rule forms. The owner
  can bring them back (S20).
- Limitations: salaries are monthly, whole months, in one currency; no payment method; no
  accrual in the settlement; an employee with a salary payment in the books cannot be removed,
  only ended (PY6).
