---
title: 'Zakat payments are partner draws made safe to repeat by a payment id, not a second ledger'
author: Usama
date: 2026-11-12
branch: main
cost: { minutes: 1, tokens: 0 }
id: l-87d3dd1c
scope: repo
status: active
replaces: l-42007123
src: agent
touches:
  - apps/api/src/modules/zakat/zakat.service.ts
  - apps/api/src/modules/zakat/zakat.controller.ts
  - apps/web/src/local-db/zakat.ts
---

## Decided

- A zakat payment is one `partner_draw` per partner, split by ownership (odd cent to the owner) and linked by `zakat_report_id`. What a report has paid is derived from its live draws. There is no zakat payment table, so cash, partner balances and the settlement see it like any draw (assumption Z7, ADR 0028).
- A payment carries a `paymentId` made on the device. Each draw's id comes from it and the partner (`zakatDrawIdOf`), so a double tap, a retry or a replay after reconnecting writes the same ids and changes nothing. The same `paymentId` with another amount or date is refused (`zakat_payment_id_reused`): that is a different payment reusing a name.
- `POST /zakat/reports/:id/payments` is `@AuditExempt` on purpose. It runs in one explicit transaction (`tx.run` takes the global advisory lock) and audits each draw only the first time. A repeat writes nothing, and the audit interceptor turns "wrote nothing" into a 500.

## Tried and ruled out

- A separate payment ledger with a method and a recipient: the spec has neither field, and a second ledger would drift from the draws the settlement already counts. The note (200 characters, `ZAKAT_NOTE_MAX`) carries a receipt number or a recipient as text.

## Watch out

- The odd cent goes to the owner on every part, so partner totals can differ by cents from sharing the sum once (assumption Z18, still `open`).
- Two offline devices can each pay what is left. The server accepts both and the screens show the excess; refusing one would lose a real payment.
- A report with anything paid cannot be voided (`zakat_report_has_payments`).

In the code: `apps/api/src/modules/zakat/zakat.service.ts`, `zakat.controller.ts`, `apps/web/src/local-db/zakat.ts` (`pay`), `packages/contracts/src/zakat-payment.ts` (`zakatDrawIdOf`).
