---
title: 'The sidebar has five groups and one nesting level, with Financial Integrity under Reports'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 70, tokens: 1592691 }
id: l-b67a59ce
scope: repo
status: active
src: agent
touches:
  - apps/web/src/shared/ui/collapsible.tsx
  - apps/web/src/shared/brand/nav-groups.ts
  - apps/web/src/shared/brand/app-shell.tsx
  - apps/web/src/app/navigation.ts
  - apps/web/src/local-db/integrity.ts
  - apps/web/src/local-db/maintenance.ts
  - apps/web/src/local-db/integrity.test.ts
  - apps/web/src/features/integrity/use-guarded-query.ts
  - apps/web/src/features/integrity/integrity-model.ts
  - apps/web/src/features/integrity/events.ts
---

## Decided

- The sidebar has five groups (Main, Operations, Finance, Reports, Administration) and one level of nesting: a page that names a `parent` is drawn indented under it, in the sidebar, in the folded rail and in the phone's More drawer. Financial Integrity (`/integrity`, route unchanged) is nested under Reports; the standalone entry is gone.
- The Reports group has no heading because its first item says what it is. Who sees which page is unchanged: the audit log, the integrity page and the accounts stay owner-only.
- The product name is Financial Integrity; the spec still says "فحص التطابق" and is the owner's to edit, so it was left alone.

## Tried and ruled out

- Collapsible groups: a destination folded away costs a tap on a till tablet.
- A new route under `/reports`: bookmarks, the service worker's precache and the e2e specs know `/integrity`.

## Watch out

- `nestNav` nests one level only. A page whose parent is not in the role's list, or whose parent is itself nested, stays at the top level. The first version dropped such children entirely, which would have hidden a page a person may open.
- With the headings the owner's menu is 728 px tall with touch rows. It fits 1440x900 and a tablet in portrait, but on a tablet in landscape (1280x800) it scrolls inside the sidebar by 131 px and Administration is cut off. Pinning Administration at the bottom is the obvious next step; it was left as a recommendation.
- The phone's More drawer needs 464 px (eight pages, three headings, 44 px rows). The primitive caps a bottom drawer at `data-[vaul-drawer-direction=bottom]:max-h-[80vh]`, which cut Settings off on a 375x812 phone; the drawer now asks for 88svh. A plain `max-h-[88svh]` class does not work: in the built CSS it has specificity (0,1,0) against (0,2,0) for the data variant, so override with the same `data-[vaul-drawer-direction=bottom]:` prefix. The full-height sheets in `features/pos/pos-screen.tsx` and `features/inventory/product-detail-screen.tsx` pass a plain `max-h-[88svh]` and are therefore still capped at 80vh.

In the code: `apps/web/src/app/navigation.ts`, `apps/web/src/shared/brand/nav-groups.ts` (`nestNav`), `apps/web/src/shared/brand/app-shell.tsx`, ADR 0027.
