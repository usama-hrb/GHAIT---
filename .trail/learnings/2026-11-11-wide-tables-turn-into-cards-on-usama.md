---
title: 'Wide tables turn into cards on a phone, and touch targets are enlarged only for coarse pointers'
author: Usama
date: 2026-11-11
branch: main
cost: { minutes: 77, tokens: 217312 }
id: l-f0af875d
scope: repo
status: active
src: agent
touches:
  - apps/web/src/shared/ui/table.tsx
  - apps/web/src/features/pos/line-dialog.tsx
  - apps/web/src/features/customers/invoice-list.tsx
  - apps/web/src/features/customers/payment-list.tsx
---

## Decided

- A table that has too many columns for a phone uses `<Table stack>`. Below `sm` each row becomes a card and each cell shows its column name from its `label` prop, so no column is hidden and the screen reader still reads a table. Hiding columns with `max-md:hidden` was dropped because a phone user then could not see the paid amount or the note at all.
- Touch targets are raised only under `pointer-coarse:` so the desktop keeps its density: list links and the sale date button get `min-h-11`, dropdown and command items get `min-h-11`, and checkboxes and radios get a hit area of `after:-inset-4`.

## Tried and ruled out

- A fixed row height such as `h-12` on a stacked row: it clips the card. Use `sm:h-12`.
- `-inset-y-3.5` for the checkbox and radio hit area: the pseudo element is placed inside the padding box, so the measured area was 38 by 42 pixels, not 44. `-inset-4` gives 46.

## Watch out

- A `Select` trigger has `data-[size=default]:h-8`, so a plain `h-auto` never wins; override the data-attribute variants too when a long value must wrap.
- The line dialog and similar footers need `flex-wrap`, or the buttons push the dialog wider than a 320 pixel phone.
  In the code: `apps/web/src/shared/ui/table.tsx`, `radio-group.tsx`, `checkbox.tsx`, `dropdown-menu.tsx`, `command.tsx`, `apps/web/src/features/pos/line-dialog.tsx`.
