---
title: 'A supplier statement reads in recording order, each purchase followed by its own paid line'
author: Usama
date: 2026-11-04
branch: refactor/product-inventory-v2
cost: { minutes: 5, tokens: 42633 }
id: l-c88f5087
scope: repo
status: active
replaces: l-1348a8c5
src: agent
touches:
  - packages/core/src/payables/index.ts
  - packages/contracts/src/supplier-payments.ts
---

## Decided

- Within one day the supplier statement lists each purchase then what was paid with it, then the day's payments, all in the order recorded (created time, then id). The balance never depends on it; only the running balance each line shows does.
- The supplier account from core carries total purchases, total paid and where each payment went, so profile figures, payment preview and shared statement cannot disagree.

## Tried and ruled out

- Sorting by kind across the whole day (all purchases, then all paid lines): two purchases on one day showed "owed after" 28,000 for a 32,000 purchase paid 10,000 (it should read 22,000). Found only by looking at the screen.
- Reordering same-day events in the web activity view alone: left the shared statement wrong.

## Watch out

- Callers of the core statement must pass records in recorded order; use the contracts statement helper.
  In the code: packages/core/src/payables/index.ts (supplierStatement), packages/contracts/src/supplier-payments.ts (accountInput), docs/adr/0015-supplier-workspace.md (SP6).
