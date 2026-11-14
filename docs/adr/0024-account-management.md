# ADR 0024: Account management for cashiers and partners

Status: accepted. One additive migration (`0034_account_management.sql`), one new API module
(`accounts`), new contracts (`accounts.ts`), a stricter authentication guard, a new Settings section
(`/settings/accounts`) and a page where an account on a temporary password chooses its own
(`/change-password`). It replaces the sentence of [ADR 0004](0004-api-foundation.md) that says a partner
account "reads everything" and the sentence of [ADR 0023](0023-owner-self-registration-and-selling-units.md)
that says cashier and partner accounts are created only with `make cashier-user` and `make partner-user`.
It adds the rows AM1–AM12 and PS1–PS4 to `accounting-assumptions.md`. No accounting rule and no stored
amount changes.

Superseded in part by [ADR 0029](0029-multi-shop-database-isolation.md) (2026-11-13): the sentences
that say the app is a single-shop system (here and in "One shop" below). One server can now serve many
shops, each with its own database. Accounts stay server-owned and online-only, and a partner account
still belongs to one partner in one shop's database. A person who works in two shops has two accounts.
The text below stays as it was written.

## Context

Until now the owner could not see who could sign in. Cashier accounts were made on the server with
`make cashier-user`; a partner account was made with `make partner-user`, belonged to no partner
record, and read every number the shop has, including the other partners' contact details, their
capital and their draws. Nothing could switch an account off without a database edit, a token already
issued stayed valid until it expired, and a login made for a partner who then left the shop kept
working.

The owner asked for an Accounts section in the owner's screens that:

1. makes as many cashier accounts as the shop needs, with no fixed maximum;
2. makes a login for a partner who already exists in the shop, at most one active login per partner;
3. lists every account, filtered by type and status, with the partner each partner account belongs to;
4. switches accounts off and on and resets credentials safely;
5. never lets a partner or cashier reach what is the owner's, and never lets a client choose a role.

The app is a single-shop system (one owner, one database per shop). This ADR does not make it
multi-tenant, but it keeps the structure that would let it become one. (ADR 0029 later did it, with a
database for each shop.)

## Decision

### A login account is not a business record

An `app_user` row says who may sign in. It is not a partner, an employee, a share of the profit or any
amount of money, and no operation here creates or removes one of those.

- Creating a cashier account creates the account and its audit entry. It creates no employee, no
  partner and no stock or money movement. A cashier is not asked for a partner, a role or a salary.
- Creating a partner account links the new login to an existing partner record. It creates no partner,
  changes no share, no capital and no draw, and gives no owner permission.
- Switching an account off sets `deactivated_at`. It removes no partner, employee, balance, capital
  contribution, settlement, sale or other record. The same holds for a reactivation and a reset.
- Partner financial rights (share, capital, draws, settlement shares) and login permissions stay in
  separate places. The first live in the partner records and their movements; the second is only the
  role of the account and its link to a partner.

### Data model (migration 0034)

`app_user` gains three columns:

- `partner_id` (uuid, foreign key to `partner`): set on partner accounts only.
- `deactivated_at` (timestamp, nullable): when the owner switched the account off.
- `must_change_password` (boolean, default false): the account is still on a password the owner gave.

The database enforces the rules that must hold under concurrency, so no check in code is the only guard:

- A partial unique index, `app_user_one_active_partner_account`, allows one active (not deactivated,
  not voided) account per partner.
- `app_user_partner_link_role` allows `partner_id` only on partner accounts.
- `app_user_active_partner_linked` requires every active partner account to be linked to a partner.
- The index from migration 0033 still allows one live owner.

Switching off is `deactivated_at`, not `voided_at`. A void cancels a record with a reason and is not
reversed; a login must be switched back on when a cashier returns. `voided_at` keeps its meaning and an
account that is voided or deactivated cannot sign in.

### The role is the route's, never the client's

There is one create route per type, `POST /accounts/cashiers` and `POST /accounts/partners`, and the
role is the one the route stands for. Neither request body carries a role. The schemas are strict, so
a request that sends `role`, `partnerId` on a cashier, or any other field the form does not list is
refused with 400 instead of being ignored. The owner role cannot be created through the API at all:
the owner is made at sign-up (ADR 0023) or with `make owner`, and the index allows only one.

Every `/accounts` route is `@OwnerOnly()`, the reads included, because the list names every login and
the partner each belongs to. A partner or a cashier gets 403 on all of them, whatever the method.
The guard refuses a partner on an owner-only route even where a partner may normally read.

### One active login per partner, and what makes a partner eligible

A partner can be given a login only if the partner record is live (not voided), is not the owner, has
not left the shop (`exitedOn` is empty), and has no active account. The screen offers only those
partners (`GET /accounts/eligible-partners`), and the server checks all of it again when the account is
made, with these issue codes: `partner_not_found`, `partner_is_owner`, `partner_exited`,
`partner_has_account`.

Concurrent requests cannot create two active logins for one partner. The transaction runs under the
global write lock that every mutating request already takes (`TransactionHost.run`), and the partial
unique index is the final guarantee: if a second request reaches the insert, the constraint name is
mapped to the same 409 `partner_has_account`. A test sends five concurrent requests and expects exactly
one 201.

A username is unique across all accounts, compared in lower case. A taken username answers 409 with
the issue `username_taken` on the `username` field.

### Switching off takes effect at once

Before this change a deactivated account would have kept working until its 15-minute access token
expired. The authentication guard now loads the account and its session on every request and refuses
the request with 401 unless the session is not revoked, the account is neither voided nor deactivated,
and the role in the token is still the account's role. Switching an account off also revokes all of its
sessions, so a refresh fails too.

- Signing in with a switched-off account answers 403 with the issue `account_deactivated`, but only
  after the right password is given, so a stranger learns nothing about which usernames exist.
- The cost is one indexed read per request. It buys immediate revocation and a role change that cannot
  be undone by a token issued before it. Tests that hand-sign a token must now use a real session.

### Temporary passwords and the first sign-in

The owner never types a password for someone else. The server generates one (sixteen characters in
four dash-separated groups, from an alphabet without look-alikes, about 90 bits, from `crypto.randomInt`),
stores only its argon2id hash, returns it once in the response that creates or resets the account, and
puts it in no log and no audit entry. The screen shows it in a dialog that cannot be dismissed by a
stray tap or by Escape, with a copy button, and keeps it nowhere afterwards.

The account is marked `must_change_password`. The guard answers every route with 403 and the issue
`password_change_required` except the ones flagged `@MayCallWhileChangingPassword()`:
`POST /auth/change-password` and `GET /auth/me`. `POST /auth/change-password` checks the current
password (`wrong_password`), requires a new one of at least twelve characters that differs from the
current (`password_unchanged`), signs out every other session of the account, and clears the flag.

On the device the sign-in lands on `/change-password`; the shop layout redirects an account in that
state there; the sync loop pauses and the device code is requested only after the change. Leaving the
page without choosing is signing out. The flag is the server's, so a typed address cannot skip it.

### Reactivating and resetting

Both issue a new temporary password, set the flag again and revoke every session. A reactivation
refuses with 409 `partner_has_account` when the partner has meanwhile been given a newer active login.
A reset on a switched-off account refuses with 409 `account_inactive`. The owner's own account is not
managed here (403 `account_is_owner`; `make owner` resets that password). A partner account made before
accounts were linked to a partner cannot be reactivated (`account_not_linked`); a new one is made.

### What a partner may see and do

A partner remains read-only (ADR 0004 and ADR 0007): the guard refuses every write except the
password change. This ADR narrows what a partner reads, so that no partner can see another partner's
private information, while SPEC §11 ("a partner who sees the same numbers") still holds for the
shop's own numbers:

- The sync hub sends a partner every record it sends the owner, except the money records of other
  partners and their private details (`recordForAccount` in `@fabric/contracts`): a partner receives
  only its own `capital_move`, `partner_draw` and `settlement_share` rows, and the other partners'
  `phone`, `notes` and `exit` fields are emptied. A cashier's access is unchanged (ADR 0007).
- These REST routes became owner-only because they return data across all partners or across the
  accounts: the audit log, `GET /partners`, the settlement preview and the settlement detail, a zakat
  report's detail, the integrity report and `/accounts`. A partner's own account figures
  (`GET /partners/:id/account`) stay available to that partner; another partner's answer 403.
- The shop's structure stays visible to a partner: each partner's name, ownership percentage and the
  profit-split rule weights. They define how the profit is divided, which a partner needs in order to
  check its own share. This is the part of the scope that the owner should confirm (PS1–PS4).
- The app hides the screens that would be empty or refused for a partner (the audit log, the integrity
  report, Settings > Accounts), and the layout shows an "owner only" notice if the address is typed.

### Legacy partner accounts

A partner login made by `make partner-user` before this change has no partner to belong to, and
guessing which partner it was would be a guess about who a login is. Migration 0034 therefore switches
every such account off, revokes its sessions and writes an audit entry for each (`update` of
`deactivatedAt`, reason "switched off by the account-management migration"). Nothing else changes. The
owner makes a linked login in Settings > Accounts, or runs
`make partner-user USERNAME=<name> PARTNER=<partner name or id>`, which now requires the partner and
goes through the same service as the screen. A deployment with no such account is unaffected.

### A partner with a login cannot be removed

Removing a partner (S19) is refused while the partner has an active login (`partner_has_active_login`
from a void guard). The owner switches the login off first, so no login ever points at a removed
partner. The guard sits on the partner entity's void, which both the REST route and the sync hub use.
The device does not know about logins (accounts are never synced), so a removal made offline on a
device is accepted locally and is rejected by the server on its next push; it then shows in the sync
issues with this reason, and the owner switches the login off and removes the partner again. The
removal is offered only for a partner who took part in nothing, so this is a rare case.

### Audit

Every change writes an `audit_log` entry in the same transaction, for the entity `app_user`:
`create` (for a partner, the reason names the partner the login belongs to), `deactivate`,
`reactivate` and `password_set` (a reset, a password change and the command line). The enum
`audit_action` gained `deactivate` and `reactivate`. The password hash is never in `before` or
`after` (`auditView` leaves it out), the temporary password is in no entry, and the reason the owner
typed is kept. A request that changes an account without writing an entry rolls back (ADR 0004).

### Where it lives

- `apps/api/src/modules/accounts`: controller, service, repository; the service is the only place the
  rules above are written. `AccountsService.setPartnerLogin` is what the command line calls.
- `@OwnerOnly()` lives in `apps/api/src/common/owner-only.ts`. It started in the auth module, but the
  audit controller needs it and the auth module imports the audit module, which made a cycle that Nest
  reported as an undefined module import.
- `packages/contracts/src/accounts.ts`: the schemas and the issue codes (`ACCOUNT_ISSUES`).
- `apps/web/src/features/accounts`, `apps/web/src/local-db/user-accounts.ts`,
  `apps/web/src/features/auth/change-password-*`.

### Offline-first

Accounts are the server's, like settings (ADR 0017): nothing is stored on a device and nothing waits in
the outbox, because a switched-off account must stop working at once and a temporary password must be
shown once. The Accounts screen needs a connection and says so; reading and changing both need it. A
device that was working keeps working offline until its next contact with the server, which then
refuses its token. Local work is kept (the same behaviour as any expired session, ADR 0004), and it
syncs when an account signs in on that device again.

### One shop

There is one shop per database, so "the same shop" is the database. The checks that a partner account
belongs to a live, non-owner, non-exited partner record in that database are the checks that apply.
If the system ever becomes multi-tenant, the shop id joins the partial unique index and the lookups;
nothing in the current structure assumes there is only one. (Superseded by ADR 0029: with a database
for each shop, the database is the shop, so no index and no lookup needs a shop id.)

## Consequences

- The owner can see, create, switch off, switch on and reset every cashier and partner login from the
  app, with a full audit trail and no password typed by anyone but the account's owner.
- A cashier account costs nothing to add: there is no limit in the code, the schema or the interface,
  and a test creates thirty.
- Behaviour changes to tell the owner: logins made before this change for partners are off until
  recreated; a partner no longer sees the audit log, the integrity report or other partners' money and
  contact details; the guard reads the database on every request; `make partner-user` needs `PARTNER=`.
- The account list loads the full set (there is no pagination). A shop has tens of accounts, not
  thousands. A cursor can be added when it matters.

## Not built

- Editing an account's role or reassigning a login to another partner (make a new one).
- Per-cashier permissions beyond the cashier role (ADR 0007).
- Email-based password reset, two-factor authentication, and a screen for changing one's own password
  at will (the route accepts it from any signed-in account; only the forced change has a screen).
- Deleting an account. Accounts are switched off, never removed (CLAUDE.md: no hard delete).
- Managing the owner's account from the app.
