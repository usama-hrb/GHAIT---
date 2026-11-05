---
title: Profit-split rules are managed only in Partners; Settlement shows the rule in effect and links to it
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 57, tokens: 775765 }
id: l-e1c2da66
scope: repo
status: active
src: agent
touches:
  - apps/web/src/features/settlements/settlement-facts.ts
  - apps/web/src/features/settlements/settlement-facts.test.ts
  - apps/web/src/shared/lib/percent.ts
  - apps/web/src/shared/lib/percent.test.ts
  - apps/web/src/features/settlements/breakdown.tsx
  - apps/web/src/features/settlements/distribution.tsx
  - apps/web/src/features/settlements/settlement-history.tsx
  - apps/web/src/features/settlements/approve-dialog.tsx
  - apps/web/src/features/settlements/period-picker.tsx
  - apps/web/src/features/settlements/settlements-screen.tsx
---

## Decided

- The split-rule table and its add/void dialog live in Partners (`/settings/partners`), not in Settlement. Partners owns who the participants are and what they hold; the rules say how profit reaches them, so there is one place to change them. Settlement reads the rules (`repositories.settlements.splitRules()`) and shows the one in effect on the period's first day (S3), whether it is the default, and a link.
- A settled period shows the weights it kept (the settlement's own record), never the current rules. A rule changed later must not move a settled month (S11, S15).
- The page status words (not settled / ready for approval / settled and locked) are a display mapping of existing state (`periodStateOf`), not a stored state: the brief said no new states.
- Percentages beside shares are display only (`permilleOf`, `formatPermille`). The "shares add up to net profit" check adds the amounts, never the percentages. The odd cent of a split goes to the shop (S2), so 2005 cents reads 668 / 668 / 669.

## Tried and ruled out

- Settlement importing from the partners feature: Partners already imports `@/features/settlements`, so the other direction would be a cycle (dependency-cruiser fails). That is why the rule table moved into Partners and Settlement only links.
- Keeping a rule table in both places: two places to change one thing.
- Offering only the next month in the period picker: a later month settles the earlier open ones with it (S7), so the picker lists every open month end, oldest first, and says so.

## Watch out

- A stale period view: the settlement view is a live query keyed on the chosen end and checked against `view.end === end`; without the check, a quick period change shows one month's figures under another month's title.

In the code: `apps/web/src/features/partners/profit-split-rules.tsx`, `apps/web/src/features/settlements/settlement-facts.ts` (`periodStateOf`, `ruleInEffect`, `distributionOf`), `apps/web/src/features/settlements/settlements-screen.tsx`, `docs/adr/0021-settlement-workspace.md`, rows SW1-SW7 in `docs/accounting-assumptions.md`.
