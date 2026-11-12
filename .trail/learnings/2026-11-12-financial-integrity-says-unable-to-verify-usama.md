---
title: 'Financial Integrity says Unable to verify, not Balanced, when a device holds no records'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 4368 }
id: l-442c9e9e
scope: repo
status: active
src: agent
---

## Decided

- Financial Integrity answers Balanced, Difference detected or Unable to verify. A device that never received the shop's records holds none, so its empty records add up to zero and used to read as balanced; it now says it cannot verify and shows no figures.
- Two causes, both decided on the device: the `PULLED_AT` meta record (written at the end of every complete pull) was never written, or the check threw on incomplete records (a sale that lost its cost). The screen catches the throw and offers "Check again".
- Balanced needs the check's `ok` and a difference of exactly zero; one cent is a difference and its sign is kept.
- No staleness threshold: how old a pull may be is a policy the owner has not set. The screen shows when records were last received and how many changes are unsent.
- Each section reads through a guarded query, so an unreadable section shows an error with a retry and the verdict still renders.

## Tried and ruled out

- Calling a device unable to verify after N hours without a pull: the limit would be an invented rule.

## Watch out

- Existing e2e specs need exactly one element whose text is the Arabic "balanced" (the verdict heading), one button containing the cash-count label and one region named after it. Do not repeat those words as exact text elsewhere on the page.
- The money line is till plus shop bank together (assumption I5), not the till drawer; the page says so under the amount.

In the code: `lastPulledAt` in `local-db/maintenance.ts`, `statusOf` in `features/integrity/integrity-model.ts`, ADR 0027.
