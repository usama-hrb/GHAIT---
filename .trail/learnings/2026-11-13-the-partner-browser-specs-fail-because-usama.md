---
title: The partner browser specs fail because the accounts spec leaves a partner behind
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 50, tokens: 131760 }
id: l-d37b5d74
scope: repo
status: active
src: agent
touches:
  - '.github/workflows/ci.yml'
---

## Decided

- Treat the partner chain of the browser suite as already red at HEAD, with the multi-shop flag on or off. All e2e specs share one database and run in alphabetical order, so the partner that `accounts.spec.ts` adds (a partner with no ownership, kept because the spec only switches its login off) is there when `partners.spec.ts` expects the empty setup form. That spec fails, and `partner-exit`, `settlements`, `zakat` and `zz-people` fail after it. The `responsive.*` specs are skipped because their seed tests did not run.
- It was proved without the flag: running only `accounts.spec.ts` and `partners.spec.ts` fails the same two tests. A full run without the flag gave 98 pass, 12 fail, 116 skipped, and the adopted multi-shop run gave the same failures.

## Tried and ruled out

- Blaming the multi-shop work: the same 12 fail with `MULTI_SHOP` off.

## Watch out

- The fix belongs in the specs (the accounts spec should remove the partner it adds, or the partner specs should not need an empty shop). It was not done because the owner's step said the specs must not change.
