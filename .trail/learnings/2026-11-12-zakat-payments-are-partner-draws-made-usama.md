---
title: 'Zakat payments are partner draws made safe to repeat by a payment id, not a second ledger'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 14753 }
id: l-42007123
scope: repo
status: active
src: agent
touches:
  - apps/api/src/modules/zakat/zakat.service.ts
  - apps/api/src/modules/zakat/zakat.controller.ts
  - apps/web/src/local-db/zakat.ts
  - docs/accounting-assumptions.md
---

## Decided

- A zakat payment is recorded as one `partner_draw` per partner, split by ownership with the odd cent going to the owner, and linked to the report by `zakat_report_id`. What a report has paid is derived from its live draws. There is no zakat payment table, so cash, partner balances and the settlement see a zakat payment like any other draw (assumption Z7, ADR 0028).
- A payment carries a `paymentId` made on the device. Every draw's id is derived from it and the partner (`zakatDrawIdOf`), so a double tap, a retry, or a replay after reconnecting writes the same ids and changes nothing. The same `paymentId` with another amount or date is refused with `zakat_payment_id_reused`, because that is a different payment reusing a name.
- The API route `POST /zakat/reports/:id/payments` is marked `@AuditExempt` on purpose. It runs in one explicit transaction (`tx.run` takes the global advisory lock, so payments are serialised) and audits each draw only the first time. A repeat writes nothing, and without the exemption the audit interceptor turns "wrote nothing" into a 500.

## Tried and ruled out

- Keeping the route audited by the interceptor: the idempotent repeat is correct but writes no audit entry, so the interceptor fails it.
- A separate zakat payment ledger with a method and a recipient: the spec has neither field, and a second ledger would drift away from the draws the settlement already counts. The note field (at most 200 characters, `ZAKAT_NOTE_MAX`) carries a receipt number or a recipient as text; method and recipient stay unsupported and the report page says so.

## Watch out

- Each part of a payment is shared between the partners separately, so the odd cent goes to the owner on every part. The partners' totals can differ by a few cents from sharing the sum once (assumption Z18, still `open`: the owner has not decided it).
- Two devices that are offline can each pay what is left. The server accepts both and the screens show the excess as "paid above what is due"; they do not hide it, because refusing one would lose a real payment.
- A report with anything paid cannot be voided (`zakat_report_has_payments`); the draws would have to be voided first, and those are locked once their settlement period is.
