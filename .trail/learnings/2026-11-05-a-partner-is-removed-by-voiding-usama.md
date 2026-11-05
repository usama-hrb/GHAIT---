---
title: 'A partner is removed by voiding, only when they took part in nothing, and the same check runs on the device and the server'
author: Usama
date: 2026-11-05
branch: main
cost: { minutes: 1, tokens: 3104 }
id: l-ad1ecde5
scope: repo
status: active
src: agent
touches:
  - 'packages/contracts/src/settlements.ts#checkPartnerVoid'
  - apps/web/src/local-db/partners.ts
  - apps/api/src/modules/partners/partners.repositories.ts
  - docs/accounting-assumptions.md
---

## Decided

- Removing a partner is a void with a reason, allowed only when the partner took part in nothing: not the owner, 0% ownership, no live capital move, draw or settlement share, no live profit rule weight above 0, and not the first partner while another partner exists (S19, which amends S18). The owner asked for removal on 2026-11-05.
- `checkPartnerVoid` runs on the device and again on the server. Partners sync as separate records, so a device that has not pulled the newest records could otherwise remove a partner who has since gained a share or a rule.
- Zero weights that a rule still lists for a removed partner are dropped when rules are read. The core split throws for a rule that names a non-participant even at weight 0, so every later settlement preview would fail without that filter.

## Tried and ruled out

- Handing the removed first partner's unnamed rules to the next partner: it changes how settled periods and the default rule read (S15, S17). The first partner is blocked instead; the owner should confirm this.
- Looking for a runtime error on the settings pages: the production build shows none. The gap was that partners could be neither edited from the list nor removed.

## Watch out

- A second REST void of an already-voided record answers 500 for every entity, because the audit interceptor rolls back a request that wrote no audit entry. Sync is unaffected; tests must not void twice through REST.

In the code: `packages/contracts/src/settlements.ts` (`checkPartnerVoid`, `withoutRemoved`), `apps/web/src/local-db/partners.ts` (`remove`), `apps/api/src/modules/partners/partners.repositories.ts` (`markVoided`), `docs/accounting-assumptions.md` (S19).
