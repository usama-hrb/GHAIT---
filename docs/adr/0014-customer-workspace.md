# ADR 0014: The customer workspace

Status: accepted (assumptions CU1–CU6).

## Context

The customer screens were a name list with a balance column, and one long page per customer: a
block of figures (Owed, Balance, Credit, Overdue, Written off), two tables, and write-off buttons in
a row. "Owed" and "Balance" were the same number for most customers, the page said nothing of what
the customer had bought or paid in all, and the statement was a bare link to WhatsApp.

## Decision

- **Every figure comes from `customerAccount` in `@fabric/core`.** The account gained what the
  screens needed so that the web does not add anything up: `purchasesCents`, `receivedCents`,
  `refundedCents` and `invoices` (every invoice not voided, settled ones too, with
  `returnedCents`), with tests (the identity purchases − received = balance is a property test).
  `features/customers/customer-view.ts` only names, filters, orders and joins what the account
  carries (status, filters, invoice and payment rows, the activity timeline).
- **A directory and a workspace.** `/customers` is a directory: customers, customers who owe and
  the total owed, search, the filters All / Owe money / Settled, and the sort (name, largest debt,
  oldest debt). `/customers/debts` is the same screen opened on who owes, oldest first; it replaces
  the separate "who owes" list. The profile (`/customers/view?id=`) is a header (who, the one gold
  action "Record a payment", share, edit, owner-only "more"), three figures (purchases, payments,
  outstanding) and five sections: Overview, Invoices, Payments, Activity, Details.
- **One payment path.** The payment dialog is still `repositories.accounts.recordPayment` with its
  `previewPayment`; it now shows what is owed, quick fills and what stays owed afterwards, all from
  the same preview. No second payment system.
- **Write-off lives in the invoice's menu**, beside "view" and "record a payment for it", behind a
  confirmation that names the invoice and asks for a reason. Owner only: a cashier is not offered
  it (RL3), and the API refuses it anyway. Nothing is deleted or edited: a write-off is a
  record, audited.
- **The statement is previewed before it is sent**, and can be copied; it still is
  `statementText`, with the latest payments added (CU5).
- **Archiving** is the existing void of the customer, owner only and only when settled (CU6).

## Consequences

- `AccountInvoice` and `CustomerAccount` have new required fields; fixtures that build them by hand
  (core, contracts, web tests) carry them.
- The customer list and the profile each read the account for every customer or for one; the
  directory counts and totals are over everyone, whatever the search.
- An opening balance on the statement is not built (CU5, open).
