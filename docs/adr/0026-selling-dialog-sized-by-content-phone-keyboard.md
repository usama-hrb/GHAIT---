# ADR 0026: The selling dialog is sized by its content, and a phone types with its own keyboard

Status: accepted. A screen change only: no contract, schema, sync handler, stored figure, price rule
or server check changed. It replaces the sixth decision of [ADR 0019](0019-pos-authorizations.md)
(a line dialog of one height) and sets where the keypad is shown.

## Context

The dialog that opens when a product is tapped on the till was given one height, `min(46rem, 100svh
− 2rem)`, so that nothing moved when a total or a warning appeared. On a desktop or a tablet that
left a large empty band under the fields whenever the line was simple. On a phone the keypad, built
for the till's tablet, stacked under the fields and pushed the line total and the Add button down the
screen, and the fields themselves had no system keyboard (`inputMode="none"`), so a phone had to be
typed on with an on-screen pad drawn inside the page, next to the phone's own keyboard that it could
not use.

## Decision

1. **The dialog is as tall as its content.** The fixed height is gone. The dialog keeps the shared
   maximum of the viewport height minus 2 rem, its body scrolls only when the screen is shorter than
   the content, and its footer stays at the bottom. Its width is `max-w-2xl` with the keypad and
   `max-w-md` without.
2. **A phone has no keypad.** A phone is a screen narrower than 640 px or shorter than 500 px (held
   sideways). On it the keypad is not rendered at all (it is not hidden with CSS), the dialog is one
   column, and the length, the price and the piece price are typed with the system keyboard:
   `inputMode="decimal"` for lengths and prices (a comma or an Arabic decimal mark is accepted by the
   core parsers), and `inputMode="numeric"` for a count of pieces. No key handler stands between the
   keyboard and the field, so deleting, selecting, moving the cursor and pasting behave as on any
   field. A tablet (800 × 1280 or 1280 × 800, for example) and a desktop keep the keypad beside the fields,
   with its fields still on `inputMode="none"`.
3. **One layout for the fields.** Header with a small picture, the name, the stock and the normal price
   with its unit. Then the length with the quick lengths, the price with the normal and the minimum
   price as buttons that fill it, the batch (oldest first by default) with the batches taken, and the
   whole-piece switch. The footer holds the line total, Cancel and the one gold action, Add. On a phone
   the total has a row of its own above the two buttons.
4. **Quick lengths only when the stock covers them.** A quick length (or count) that is larger than
   what the product has is not offered. This is a screen filter that uses the core parsers; the stock
   check itself is unchanged.
5. **The keypad is smaller and plainer.** Keys are 48 px (56 px on a touch screen), digits on filled
   keys and the point and delete outlined. The same keypad serves the discount and the payment, which
   only gain room.
6. **Nothing about prices changed.** The owner's confirmation under the minimum and the one under the
   cost are asked in the same strips, are tied to the price they were given at, are not asked again at
   payment, and are still checked by the server. The dialog shows no profit or margin.

## Alternatives rejected

- Hiding the keypad on a phone with CSS: the keypad would stay in the tree and in the tab order, and
  the fields would still carry `inputMode="none"`.
- A keypad for every screen, made smaller: a phone has a better keyboard of its own, and a pad drawn
  in the page plus the keyboard would cover the fields.
- Choosing the keypad by pointer type (`pointer: coarse`): a phone and the till's tablet are both
  coarse, and what differs is the size of the screen.
- Selecting the whole field when it takes the focus on a phone, so that a first digit replaces the
  normal price: it fights the cursor placement that a tap is meant to do. The quick price buttons
  fill the field instead.

## Consequences

- The dialog's height changes with its content (for example when a confirmation strip appears). The
  footer and the strips do not move relative to the bottom of the dialog.
- On a phone, a price that is already filled is edited with the phone's keyboard (delete, then type)
  or replaced with one of the two quick price buttons.
- `CountInput` now asks for a numeric keyboard wherever it is used (pieces are whole numbers).
- iOS Safari does not resize the page when its keyboard opens (`interactiveWidget` is not supported
  there), so the dialog relies on the browser scrolling the field in. This was measured by shrinking
  the window, not on a device.
