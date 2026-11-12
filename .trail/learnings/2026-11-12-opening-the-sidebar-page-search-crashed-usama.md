---
title: Opening the sidebar page search crashed the whole shop screen because the command dialog had no command root
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 22, tokens: 542829 }
id: l-60734140
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/zz-probe-sidebar-search.spec.ts
  - apps/web/src/i18n/ar.ts
  - apps/web/src/i18n/en.ts
  - apps/web/src/shared/brand/not-found-screen.tsx
  - apps/web/src/app/not-found.tsx
  - apps/web/src/shared/brand/not-found-screen.test.tsx
  - apps/web/e2e/not-found.spec.ts
  - apps/web/e2e/responsive.spec.ts
  - apps/web/src/shared/ui/command.tsx
  - apps/web/src/shared/brand/app-shell.tsx
---

## Decided

- `CommandDialog` now wraps what it is given in a `Command` root, so callers pass only the parts. cmdk's input, list and empty state read their state from that root and throw "Cannot read properties of undefined (reading 'subscribe')" without it. The radix-nova template leaves the root to the caller and the page search never added one, so opening it threw inside the shop layout, which has no error boundary above it: the screen died.
- The dialog also remembers what had the keyboard when it opened and hands it back on close. Radix returns focus only to a trigger button, and this dialog is opened by state (the sidebar field, Ctrl K), so focus used to fall to the page body.
- The sidebar field is 44 px tall on a touch screen like the rows under it (`pointer-coarse:h-11`).
- `e2e/page-search.spec.ts` guards all of it: opens, says when nothing matches, Escape returns focus, Ctrl K toggles, Enter goes to the page, no `pageerror`, 44 px on a tablet. No unit test can: the web tests have no DOM, and the dialog's portal renders nothing on the server.

## Tried and ruled out

- Judging the field by its layout (label, the Ctrl K hint, focus ring, tooltip, rail): all fine. The fault showed only in a browser run that clicked the field and listened for `pageerror`.
- Measuring an option right after the dialog opens: it zooms in, so 44 px read 43.07. Poll until it settles.
- Typing "inv" in English finds nothing: the page is named "Stock" there. The search matches the visible name, not the route.

## Watch out

- Do not add a second `Command` inside a `CommandDialog` caller (`nav-palette.tsx`, the `/design` shell demo).
- Vendoring shadcn's `command.tsx` again drops both local changes.

In the code:

- apps/web/src/shared/ui/command.tsx
- apps/web/src/shared/brand/nav-palette.tsx
- apps/web/src/shared/brand/app-shell.tsx
- apps/web/e2e/page-search.spec.ts
