---
title: 'A fake server for settings must update one row per key, as the real one does'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 11, tokens: 85805 }
id: l-eea81efc
scope: repo
status: active
src: agent
touches:
  - apps/web/src/local-db/shop-settings.test.ts
  - docs/adr/0017-settings-workspace.md
---

## Decided

- A test double that plays the server for settings replaces the row it already holds for a key (same id) instead of inserting a new row on each pull. The real server keeps one row per key and changes it in place.

## Tried and ruled out

- Inserting a fresh row (random id) on every simulated pull with the same fixed timestamps: the device then holds two rows for one key that tie on time, so which one wins depends on the random id. The test passed and failed on different runs ("expected the logo to be null", and the unit-switch test) and looked like a bug in the repository.
- Re-running until green: it hid the cause.

## Watch out

- A failure that changes between runs of the same test is a tie between rows, not a race in the code under test. Check the fake's ids and timestamps first.

In the code: `pulled()` in `apps/web/src/local-db/shop-settings.test.ts`; run `pnpm exec vitest run src/local-db/shop-settings.test.ts` several times to confirm it is stable.
