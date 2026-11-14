---
title: 'The owner approved five contrast token changes, so the contrast test is green and the baseline is clear'
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 2, tokens: 20571 }
id: l-3ee4ae0a
scope: repo
status: active
replaces: l-503f146e
src: agent
touches:
  - apps/web/src/app/globals.css
  - docs/design-usage.md
  - apps/web/src/app/tokens.contrast.test.ts
---

## Decided

- The owner approved changing brand tokens for contrast ("I approve everything"). Five values in `apps/web/src/app/globals.css` changed, each only as far as needed with a margin: light `--muted-foreground` #6f6864, light `--warning` #976217 (`--debt` follows), light `--input` #8e8a84, dark `--input` #756e6e, and a dark `--estimated` of `var(--gold-500)` (the light value, gold-800, was 2.8:1 on dark surfaces). `tokens.contrast.test.ts` is unchanged and passes (65 of 65); the web suite is 886 of 886.
- The input border is the visible change: it was 1.4:1 (light) and 2.0:1 (dark) against the 3:1 that WCAG 1.4.11 asks for.
- The spec fixes of the same audit stay: `accounts.spec.ts` voids the partner it adds, `language.spec.ts` uses the "Switch to …" button and an exact password label.

## Tried and ruled out

- Editing `brand-tokens.css`: it is not in the repo. The app's values live in `globals.css`, with the approved changes listed in a comment at the top of the brand block and in `docs/design-usage.md`.

## Watch out

- `bg-input/30` (dark buttons, the command box) and the unchecked switch track use the same token, so they are a little lighter in dark and a little darker in light. Text on them still passes.

In the code: `apps/web/src/app/globals.css`, `apps/web/src/app/tokens.contrast.test.ts`.
