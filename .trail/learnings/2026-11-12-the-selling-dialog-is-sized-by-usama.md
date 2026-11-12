---
title: 'The selling dialog is sized by its content, and a phone types with its own keyboard instead of the keypad'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 23, tokens: 191047 }
id: l-c44c4483
scope: repo
status: active
src: agent
touches:
  - apps/web/e2e/line-dialog.spec.ts
  - docs/adr/0026-selling-dialog-sized-by-content-phone-keyboard.md
  - apps/web/src/features/pos/line-dialog.tsx
  - apps/web/src/shared/format/keypad.tsx
---

## Decided

- The line dialog no longer has a fixed height. It is as tall as its content, up to the viewport minus 2 rem, and only its body scrolls. The fixed `min(46rem, 100svh - 2rem)` of ADR 0019 left a big empty band on a desktop and could not be told apart from a bug.
- A phone (under 640 px wide or under 500 px tall) gets no keypad: it is not rendered, the dialog is one column and the fields use the system keyboard (`inputMode="decimal"`, `numeric` for whole pieces). A tablet in either orientation and a desktop keep the keypad. The split is by screen size, not by `pointer: coarse`, because the till's tablet and a phone are both coarse.
- The owner's two confirmations, the server checks and the cart and sync code are untouched; only the layout changed. Quick lengths are hidden when the product's stock cannot cover them.

## Tried and ruled out

- Hiding the keypad with CSS on a phone: it stays in the tab order and the fields would still be `inputMode="none"`, so the phone keyboard never opens.
- Selecting the whole price when it gets the focus, so a first digit replaces the normal price: it fights the cursor placement of a tap. The Normal and Minimum buttons fill the price instead.

## Watch out

- A test that seeds a product as its last step must wait until nothing is pending (the connectivity badge) before it ends, or the next device never receives that product.
- The confirmation strip is two rows of text on a 320 px phone (about 100 px tall); a limit made for the desktop strip fails there.
- iOS Safari ignores `interactiveWidget`, so the keyboard shrinking the dialog was only measured by resizing the window, not on a device.
  In the code: `apps/web/src/features/pos/line-dialog.tsx` (`PHONE`, `keypad`), `apps/web/src/shared/format/keypad.tsx`, `decimal-input.tsx` (`inputMode`), `apps/web/e2e/line-dialog.spec.ts`, `docs/adr/0026-selling-dialog-sized-by-content-phone-keyboard.md`.
