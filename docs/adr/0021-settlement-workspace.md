# ADR 0021: The settlement as a workspace; the profit-split rules move to Partners

Status: accepted. No formula, stored figure, contract, schema, migration, sync handler or server
check changed. The rules this records are rows SW1–SW7 in `accounting-assumptions.md`.

Amended by [ADR 0022](0022-people-partners-and-salaries.md): where this text says "owner, partner,
shop", the distribution lists the owner, every partner and the shop, and a rule can carry one
weight per partner. The page, its states and the approval flow are as described here.

## Context

`/settlements` was one stacked page: a period date field, a preview card with the breakdown as a
flat list, a split-rule table, and a history list. It worked, but the owner could not answer the
questions a month-end close asks: which month am I closing and what is its state, how is the net
profit made (and is each adjustment shown even when it is zero), who receives what and under which
rule, what exactly will approving lock, and what did a past month close with. The split-rule
management sat in Settlement although who the participants are, and what they hold, lives in
Partners. The approval was a single button that opened a short confirmation.

Everything that matters for correctness already existed and stays: the figures come from
`@fabric/core` (`periodResultOf`, `computeSettlement`, `splitNetProfit`, `splitByWeights`,
`splitByOwnership`) through `previewSettlement` in `@fabric/contracts` (ADR 0005). Approving and
unlocking are server operations; the device previews offline from its own records.

## Decision

### One page, four parts, presentation only

`SettlementsScreen` shows, top to bottom: the period picker and a summary band (net profit, period,
status, the one action for that state); the breakdown (profit, then the adjustments in four
groups with subtotals, then the net profit); the distribution (owner, partner, shop, with weight,
percentage and amount, and the shop's share by partner); the history. A settled period opens the
same view with the figures it was approved with, and `/settlements/view?id=` is the same view for
one settlement.

Nothing on the page works out an accounting amount. `settlement-facts.ts` turns a preview or a
settlement into one `SettlementFacts` shape and groups it; it only adds the lines the contracts
already carry, and flags a mismatch (lines that do not add up to the net profit, shares that do not
add up to it) instead of hiding it. The status words (_not settled_, _ready for approval_,
_settled and locked_) are derived from existing state, never stored (SW2).

### Every line is shown, zero or not

A breakdown that hides zeros cannot be reconciled by the reader. The groups keep their order and
signs (deductions are negative, as `SettlementLine` stores them), each line has a short
explanation, and each group has a subtotal. The grouping (profit; returns and recoveries; losses;
expenses and cash; carried deficit) is a layout of the existing keys: no line moved to another
accounting meaning.

### The period picker lists every open month end

The old page offered the next month only, and a later month was reachable only by typing a date. The
picker lists each ended month end since the last settlement (the oldest first), the settled
periods, and "another end date". Picking a later month settles the earlier ones with it (S7) and
the page says so (SW1). The default is the oldest open month.

### The split rules are managed in Partners

`ProfitSplitRules` (`features/partners/profit-split-rules.tsx`) is the old Settlement rule table
and dialog, moved and restyled; the rules themselves, the S15 conditions and the repository calls
are unchanged. Settlement imports nothing from Partners (Partners already imports Settlement, and
the dependency rules allow one direction): it shows the rule in effect on the period's first day,
whether it is the default, and a link. A settled period shows the weights it kept, never the
current rules (SW5).

Alternatives dropped: keeping a rule table in both places (two places to change one thing); moving
the table and a "rules" tab into the settlement page's header (Partners is where the owner already
goes to change who holds what).

### Approval is a confirmation, then the server's word

The dialog loads the server's preview (every device's records, S16) and shows the period,
recognised profit, the adjustments' total, the net profit, each share and what the lock means. The
confirm button waits for the server: nothing is called approved until `approve` resolves; a refusal
stays in the dialog; a 409 `settlement_preview_changed` fetches a fresh preview; the dialog cannot
be closed or the button pressed again while the request is pending (SW7). The dialog and the page
say that approving records shares, not payments (SW4): no withdrawal, cash movement or partner
payment is created, as before.

### Stale views

The period view is a live query keyed on the chosen end and the settlement id, and is checked
against the end it was read for. A view of another period is treated as not yet loaded, so a
quick change of period never shows one month's figures under another month's title.

## Consequences

- No migration, no new contract, no server change; `local-db` gained `openPeriodEnds` /
  `nextPeriodEnd` (pure date helpers over the settled days it already reads).
- The percentages (`permilleOf`, `formatPermille` in `shared/lib/percent.ts`) are display only (SW3).
  The allocation check adds the amounts, not the percentages.
- `settlement-facts.test.ts` runs the real `computeSettlement` and encodes the SPEC odd-cent cases
  (T6/T7: 333 333 / 333 333 / 333 335 cents), the ownership split of the shop share, the rule in
  effect by period start, and that a preview and the settlement made from it give the same facts.
- The `settlements.spec.ts` e2e settles a month whose net is an odd number of cents (normally 2005:
  668 / 668 / 669) and compares the page with the server's own `/settlements`. The spec works the
  shares out from the cash count it really made, in integer cents, because the cash the records
  show depends on the specs that ran before it. It also checks the lock, the unlock, the history
  and the layout at desktop, tablet and phone widths.
- The settlement can show a period with nothing to share as "ready for approval" (a zero net is
  settled like any other, as before); a month with no records still needs the owner to approve it.
