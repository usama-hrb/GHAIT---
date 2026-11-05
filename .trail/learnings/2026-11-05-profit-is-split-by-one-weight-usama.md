---
title: "Profit is split by one weight per participant, and a rule that names no partners belongs to the shop's first partner"
author: Usama
date: 2026-11-05
branch: refactor/product-inventory-v2
cost: { minutes: 1, tokens: 9290 }
id: l-7877d482
scope: repo
status: active
src: agent
touches:
  - packages/core/src/settlement/split-rule.ts
  - packages/core/src/numeric/split.ts
  - packages/contracts/src/settlements.ts
  - docs/accounting-assumptions.md
---

## Decided

- The net profit is split once, by weights, among the owner, every partner and the shop, in one fixed order: the owner, the partners by id, the shop. The division's leftover cents go to the shop (S1). The shop's retained share is then divided among the owner and the partners by ownership with the largest remainder, the odd cent to the owner first and then the partners by id (S2). One fixed order means every device and the server give the same odd cent to the same person.
- A split rule keeps its three old weight columns and gains a nullable `partner_weights` (a list of partner id and weight). A rule with none, which is every rule written before and the default 1/1/1, is read as the weight of the shop's first partner: the earliest-created live partner who is not the owner, ties by id. A partner who joins later is therefore outside the default rule and outside every period already settled, and gets a share only from a new rule dated in the future (S15).
- Nothing is backfilled and nothing in a settled period is touched. A settlement keeps the weights it used in its own `partner_weights`, so an old settlement reads the same whatever rules come later.
- A partner's status (active or inactive) is derived, not stored: the owner is always active, a partner is active when ownership is above 0 or a rule that is in force now or later gives a weight above 0.

## Tried and ruled out

- Backfilling `partner_weights` onto old rules and settlements: it rewrites the record of months that were approved and locked (S11).
- Giving a newly added partner an equal share by default: with the old 1/1/1 rule it would hand someone who joined this month a slice of profit that was settled before they joined.
- Keeping only the owner, partner and shop columns: they cannot hold a second partner's weight.
- A stored active/inactive field on the partner: it could disagree with the ownership and the rules it is derived from.

## Watch out

- `partnerWeightsFor` in core throws when a rule that names no partners meets more than one partner. A caller reads the first partner's weight through `partnerWeightsOfRule` and passes it in; it must not assume one partner.
- Rules can only be added or voided for dates after the day they are typed, and there is one live rule per date (S15). A partner's share of an earlier date cannot be changed from the Partners screen.

In the code: `packages/core/src/settlement/split-rule.ts` (`splitNetProfit`, `partnerWeightsFor`), `packages/core/src/numeric/split.ts` (`splitByWeights`), `packages/contracts/src/settlements.ts` (`firstPartnerOf`, `splitRulesOf`, `partnerWeightsOfRule`, `partnerStatusOf`), `apps/api/drizzle/0031_people_and_salaries.sql`, `docs/adr/0022-people-partners-and-salaries.md`, rows S1, S2, S15, S17 and S18 in `docs/accounting-assumptions.md`.
