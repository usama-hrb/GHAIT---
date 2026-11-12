# Runbook: API accounts, secrets and migrations

These steps work for both stacks; add `STACK=prod` on the server (the default is `STACK=dev`). The stack must be running (`make up`). Design: [ADR 0003](../adr/0003-orm.md) (Drizzle), [ADR 0004](../adr/0004-api-foundation.md) (auth, audit).

## First start on a new server

1. In `.env`, set a real `POSTGRES_PASSWORD` and `JWT_ACCESS_SECRET`:

   ```sh
   openssl rand -hex 24      # POSTGRES_PASSWORD
   openssl rand -base64 48   # JWT_ACCESS_SECRET
   ```

   In production the API refuses to start while `JWT_ACCESS_SECRET` still contains `change-me`.

2. Start the stack with `make up STACK=prod`. The API applies the migrations before it listens.
3. Create the owner account:

   ```sh
   make owner STACK=prod USERNAME=owner NAME="صاحب المحل"
   ```

   You are asked for the password (12 characters or more). It is not echoed and never appears in the process list or the shell history. The account creation is in `audit_log`.

Instead of this command, the owner can open `/signup` in a browser on a server that has no owner yet and create the account and the shop there ([ADR 0023](../adr/0023-owner-self-registration-and-selling-units.md)). The page closes as soon as an owner exists. On a server reachable from the internet, do one of the two straight after the first start; to rule out the page altogether, set `OWNER_SIGNUP_ENABLED=false` in `.env` and use the command. The command stays the way to reset the owner's password.

## Forgotten password

Run the same command with the existing username:

```sh
make owner STACK=prod USERNAME=owner
```

It sets the new password and signs the owner out on every device (all refresh tokens are revoked). It refuses a different username while an owner exists.

## Rotate the access-token secret

Change `JWT_ACCESS_SECRET` in `.env`, then `make up STACK=prod`.

Access tokens signed with the old secret stop working at once. Clients get a new one with their refresh cookie (refresh tokens do not depend on this secret), so nobody has to sign in again. To also sign every device out, reset the password as above.

## Migrations

- **Apply:** the API applies pending migrations on start. `make migrate [STACK=prod]` does it by hand in the running api container.
- **Create** (development, on the host):

  ```sh
  make migrate-new NAME=add_fabric             # SQL generated from apps/api/src/database/schema
  make migrate-new NAME=fabric_views CUSTOM=1  # empty file for hand-written SQL
  ```

  Review the generated SQL and commit it with the schema change. CI fails when the schema and the migrations disagree.

- **Every new table** uses `baseColumns('<table>')` in its schema. Its migration calls `SELECT install_row_guards('<table>', <append_only>);`, which refuses DELETE/TRUNCATE, blocks UPDATE on append-only tables, and sets `server_seq`. `test/database.e2e-spec.ts` fails for a table without them.
- Take a backup before applying migrations on the server: `make backup STACK=prod` ([backup runbook](backup.md)).

## Logs

`make logs SERVICE=api [STACK=prod]` shows JSON lines (pino). Every response has an `x-request-id` header. The same id is in that request's log lines, in its error body (`error.requestId`), and in the audit entries it wrote. Search the logs for it.

## Accounts: who can sign in

The owner manages cashier and partner logins in the app, under **Settings > Accounts** (needs a connection, owner only; [ADR 0024](../adr/0024-account-management.md)). There the owner:

- sees every account with its type, status and, for a partner account, the partner it belongs to, and filters by type and status;
- creates a cashier account (any number; no partner, role or salary is asked for) or a login for an existing partner (only partners who are not the owner, have not left the shop and have no active login are offered; a partner has at most one active login);
- switches an account off or on, and resets its credentials.

The owner never types someone else's password. Creating, reactivating and resetting show a **temporary password once**, in a dialog that must be acknowledged; hand it to the person. They are asked to choose their own password at the first sign-in and can do nothing else until they do. A reset or reactivation signs the account out everywhere.

Switching an account off takes effect on the next request: its sessions are revoked and every API call with an older token answers 401. It removes nothing: the partner, the employee, balances, capital, settlements and sales stay, and the account's audit history stays (`create`, `deactivate`, `reactivate`, `password_set` under the entity `app_user`). An account is never deleted. A partner who still has an active login cannot be removed (`partner_has_active_login`); switch the login off first. A device that was working when its account was switched off keeps the local data it has and shows "sign in again to sync" at its next contact with the server; the switched-off account cannot sign in again.

The owner's own account is not managed there: `make owner USERNAME=<name>` creates it or resets its password.

### The partner's read-only account

```sh
make partner-user USERNAME=<name> PARTNER=<partner name or id> [NAME="<display name>"]   # add STACK=prod on the server
```

Command-line alternative to the screen, for a server without a browser at hand. It requires the partner (the account belongs to that partner record), goes through the same rules as the screen, prints a temporary password once (the account must change it at the first sign-in) and, if the partner already has an active login, resets that login's password instead (signing it out everywhere). A partner account reads the shop's numbers and its own money records only; it never sees another partner's capital, draws, settlement shares or contact details, nor the audit log, the integrity report or the accounts list. The API refuses its writes and its devices do not save any (ADR 0004, Roles; ADR 0024). The owner keeps the only account that changes the shop.

## A worker's account (cashier)

The owner makes these under Settings > Accounts (see above). From the command line:

```sh
make cashier-user USERNAME=<name> [NAME="<display name>"]   # add STACK=prod on the server
```

Creates an account for someone who works the till, or sets a new password for it (signing it out everywhere). There can be several, with no fixed maximum. It **sells, takes customers' payments and adds customers**, and nothing else; it never receives a cost, a profit, or any record of the partners' money ([ADR 0007](../adr/0007-returns-payables-roles.md), docs/accounting-assumptions.md RL1–RL5):

- the sync hub sends its device the catalog, the rolls **with their cost set to 0**, stock moves, customers, sales, payments, returns and three settings (the shop's name, the money unit, the remnant length); purchases, suppliers, expenses, partners, settlements, zakat, counts and conflicts are not sent;
- every REST route except the sync hub, device registration and its own profile answers 403;
- it cannot void, return, refund, write off, buy, spend, or confirm a sale under cost. Its device refuses the same changes before saving, and the server rejects them if they arrive anyway (Settings → sync issues shows them on the worker's device).

A sale under cost made at the till is **rejected by the server** (the device saw no cost, so it could not warn). It appears in the owner's sync issues; decide what to do with the sale that happened at the counter and enter it again with the confirmation.

## Returns and what the shop owes suppliers

**Returns.** On the sale's page (owner's account), "إرجاع بضاعة": choose the length of each line, write the reason, and say how much of the overpayment is handed back in cash (the rest stays as the customer's credit; a walk-in buyer gets all of it). The cloth goes back on its roll; mark the roll a remnant if it is no longer part of a whole one. The profit already recognised on those goods is reversed **on the day of the return**, so a settled month never changes. A sale with returns cannot be voided: return the rest. Over the API: `POST /sales/:id/return` with `{ date, reason, lines: [{ lineId, returnedCm }], refundCents }`.

**Suppliers.** When a purchase is only part paid ("المدفوع الآن"), the rest is a debt to the supplier (the purchase needs one). The screen "ديون الموردين" lists who the shop owes and shows each supplier's statement; "دفع للمورد" records a payment (never more than is owed, from the shop's cash). A mistaken payment is voided with a reason. Over the API: `GET /supplier-payables`, `GET /suppliers/:id/statement`, `POST /suppliers/:id/payments` with `{ amountCents, date, purchaseId? }`, `POST /supplier-payments/:id/void` with `{ reason }`. The integrity check carries the debt as a claim (`supplier_payables`) and the zakat base subtracts it.

## Settling a month, and unlocking it

The owner settles from the Settlement screen (التسوية): pick the period's end, read the breakdown, approve. Approving needs a connection: the server settles on every device's records ([ADR 0005](../adr/0005-settlement-and-period-lock.md)). Sync the phone and every other device first.

Once approved, nothing dated in the period can be added, changed or voided (docs/accounting-assumptions.md S11). When something must change in it:

1. On the Settlement screen, unlock the latest period (فتح الفترة) and write why. Only the latest can be unlocked; for an older month, unlock the later ones first, newest first.
2. Make the change.
3. Settle the period again.

A sale or payment made offline and dated in a period that was settled before the device synced is refused by the server (`period_locked`). It shows on that device under Settings → sync issues. Unlock the period, enter it again on a device, and settle again.

The same operations over the API, for scripts: `GET /settlements/preview?end=YYYY-MM-DD`, `POST /settlements` with `{ periodEnd, expected }` (`expected` is the preview's `breakdown`; 409 if records arrived since), `POST /settlements/:id/unlock` with `{ reason }`. Every approve and unlock is in the audit log (`GET /audit?entity=settlement`).

## The integrity check shows a difference

The Financial Integrity screen (التطابق المالي, under Reports in the menu) compares what the shop holds with whose it is, to the cent, from that device's records (docs/accounting-assumptions.md I1–I8). It answers _Balanced_, _Difference detected_ (with the exact amount and which way it goes) or _Unable to verify_: the last means the device has not received the shop's records yet, or holds incomplete ones, so connect it, wait for the first sync and press Check again; it never means the shop is balanced. `GET /integrity` gives the same check on the server's records (ADR 0027).

1. **Sync every device**, then look again. A difference on one device only means that device lacks records, or the server refused one of its changes: Settings → sync issues.
2. If the server shows it too (`GET /integrity`), look at the latest changes listed on the screen and in the audit log (سجل التعديلات, or `GET /audit?from=YYYY-MM-DD&to=YYYY-MM-DD`), filtered by the day the figures last agreed.
3. A record changed outside the app (SQL on the database) is the usual cause. The audit log shows every change the API made, so a change that is not in it was made outside.

A cash count is not a fix for a difference: it records what was counted, and the check stays balanced either way. Count the till and the shop's bank account together (I5), after every device has synced.

## Zakat

The Zakat screen (الزكاة, [ADR 0028](../adr/0028-zakat-management-center.md)) is the Zakat Management Center. It says where the hawl stands in one state (not configured, waiting for the hawl, hawl in progress, nisab not reached, review required, zakat due, calculation completed, payment recorded), worked out from the records and the settings, never from the reminder. Its one main action, "Review Zakat calculation", opens a seven-step review that records nothing until the last step is confirmed; items that block the calculation (no hawl start, no metal price, a device that never received the shop's records) must be fixed first.

The settings (hawl start, nisab metal and its price per gram with the day it was seen, valuation, doubtful debts, reminder days) are on their own page, "Methodology settings"; changing them needs a connection and affects future calculations only. On the hawl, save the report (it works offline), then record the payment, in one or several parts: each part becomes a draw on each partner by ownership (docs/accounting-assumptions.md Z5–Z10, Z18). A saved report is never recalculated or edited; a wrong one is voided with a reason, while nothing is paid on it, and the review is done again. The figures are a calculation, not a ruling: the settings follow the scholar the owner follows, and the assumptions marked `open` (Z11–Z18) are choices the owner has not yet confirmed.

Over the API (the owner only; a cashier's token gets 403, a partner reads through sync):

- `GET /zakat/reports`: every report, the latest hawl first, voided ones included.
- `GET /zakat/reports/:id`: the report with what was paid and the draws that paid it.
- `POST /zakat/reports/:id/payments` with `{ amountCents, date, note?, paymentId? }`. Naming the payment with a `paymentId` (a uuid) makes it safe to repeat: the same request again changes nothing and answers as the first time; the same `paymentId` with another amount or day is refused (`zakat_payment_id_reused`). More than what is left is refused (`zakat_payment_above_due`).
- `POST /zakat/reports/:id/void` with `{ reason }`, refused while something is paid on it (`zakat_report_has_payments`).

A report arriving through sync is refused unless its hawl has come (`zakat_hawl_not_reached`, `zakat_hawl_in_future`), its figures follow from its items by the core function (`zakat_report_does_not_match_core`). A database index allows one live report per hawl.
