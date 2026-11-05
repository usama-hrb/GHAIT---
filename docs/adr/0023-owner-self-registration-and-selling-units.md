# ADR 0023: Owner self-registration, and the shop's selling units

Status: accepted. One additive migration (`0033_owner_single.sql`), one new setting (`selling_units`),
one new API module (`registration`), new contracts, two new web screens (`/signup` and
`/settings/selling`) and a redesigned sign-in page. It replaces one sentence of
[ADR 0004](0004-api-foundation.md) (there is no HTTP setup route) and adds the rows SU1–SU5 and OS1–OS4
to `accounting-assumptions.md`. No accounting rule and no stored amount changes.

## Context

Until now the owner account existed only through `make owner` on the server. That is safe, but a
shop owner who rents a server has to run a command on it before seeing anything, and the sign-in
page was the only page of the app that did not look like the rest of it.

Two requests came together:

1. A sign-up page where the owner creates the account and sets the shop up: name, optional logo,
   the units the shop works in, and the currency.
2. Three independent switches for the units: Unit / Piece, Kilogram (kg) and Meter (m), with at
   least one on and no presets, shown at sign-up and again in Settings.

The app is a single-shop system (one owner, one partner, one database per shop). It is not
multi-tenant, and this ADR does not make it so.

## Decision

### Sign-up creates the first owner, then closes

`POST /auth/register` creates the owner account and the shop's settings in one transaction and
signs the new owner in. It works only while the server has no owner. As soon as one exists it
answers 403 with the issue code `registration_closed`, `GET /auth/registration` answers
`{ "open": false }`, the sign-in page shows no link to it, and `/signup` shows a closed notice.

- **The database guarantees one owner.** A partial unique index (`app_user_single_owner`, migration 0033) allows one live row with the role `owner`. Two sign-ups racing each other cannot both
  succeed: the second hits the index and gets the closed answer. This is the guarantee; the check
  for an existing owner before the insert only gives the nicer message.
- **The role is never sent by the client.** The request has no role field, and a field the form does
  not list is dropped by the schema. The server writes the role `owner` itself. Nothing in the
  request chooses the shop either: there is one.
- **One transaction.** The account, its audit entry, the four settings (`shop_name`, `shop_logo`
  when given, `selling_units`, `money_display_unit`) and their audit entries commit together, or
  none of them do. A failure in any settings write leaves no account behind and the form can be
  sent again.
- **Hashing, cookies, limits.** The password is hashed with argon2id as in ADR 0004. The refresh
  token travels in the same `httpOnly`, `SameSite=Strict` cookie. The route has its own throttler,
  `AUTH_REGISTER_RATE_LIMIT` (default 5 a minute per client IP). The email is the username: it is
  stored lower case, and an address already used answers 409 with the issue code `email_taken`.
- **A switch to turn it off.** `OWNER_SIGNUP_ENABLED=false` closes sign-up even on an empty
  database, for a server whose owner is created with `make owner`. `make owner` still works and
  remains the way to reset the owner's password.
- **Module layout.** Registration is its own module. Putting it in the auth module made a cycle
  (settings, sync, the sync controller and the auth index import each other), which Nest reports as
  an `undefined` module at start-up. `AuthService.registerOwner(account, setUpShop)` takes the
  settings writes as a callback, so auth does not import settings.

### The three units are settings, and gate new work in the interface

`selling_units` is a server-owned setting, `{ piece, kg, meter }`, three booleans. At least one must
be true; the contract and the server both refuse all three off. A shop that already exists has all
three on, so nothing changes for it. There are no presets: each switch is independent.

- **Unit / Piece and Meter control what can be sold.** A product can be offered for sale in a unit
  only while the shop has that unit on. The POS tiles, the line dialog and the product form
  follow the setting.
- **Kilogram controls buying by weight.** In this system weight is a way of buying only (rule
  PB7, enforced by the contract and a database CHECK in migration 0027). A shop that turns
  Kilogram off cannot start a purchase or first stock in kilograms. A shop with only Kilogram on can
  buy and stock by weight, and the interface says plainly that nothing can be sold until Meter or
  Unit is switched on. The owner chose this reading over making kilogram a selling unit, because
  the second would need a new sale unit in the accounting core and a ledger migration.
- **Nothing recorded is changed or rejected.** The setting gates new work in the interface. The
  server only checks that one unit is on and that the writer is the owner; it never refuses a
  synced product, purchase or sale because a unit is now off. A device that was offline when the
  owner switched a unit off can still push what it recorded earlier, and a unit switched off and
  on again finds its history intact.
- **Safe disabling.** Settings refuses a change that would leave an active product with no unit it
  can be sold in, and says how many products are affected. A change that only stops a product
  from being restocked in its unit is allowed, with a notice. This guard runs on the device
  against its local copy of the products. It is advice for the owner, not a server rule, for the
  reason in the previous point.
- **Currency.** The sign-up asks for rial or dirham and writes `money_display_unit`. It only changes
  how amounts are typed and shown (1 dirham = 20 rial); stored cents never change, as in ADR 0017.

### Screens

The sign-in page and the sign-up wizard share one layout: a brand panel beside the form on a wide
screen, the form alone with the logo above it on a tablet held upright or a phone. The wizard has
four steps (account, shop, selling units with the currency, review) and the review step names every
choice before "Create my shop". Settings gets a "Selling units" section beside Business profile and
Currency; a cashier's account can read the setting (the till needs it) and cannot change it. New
stock and new purchases start from the product form and the restock panel, which offer only the
units the shop buys in; the purchase page itself only shows purchases already made.

### What this does not do

- **No email verification and no password recovery.** Both need a mail service the deployment does
  not have. The email is used as the sign-in name only. The owner's forgotten-password path stays
  `make owner` on the server.
- **No multi-shop isolation.** There is one shop per server and one owner per shop. Isolating
  several shops would need a shop id on every table and every query, which is a different
  project.
- **No sign-up for partners or cashiers.** The owner creates their accounts. At first this was done
  only with `make partner-user` and `make cashier-user`; [ADR 0024](0024-account-management.md) adds
  Settings > Accounts for it (the commands remain).

## Consequences

- A new server can be set up from a browser. The first visitor to `/signup` becomes the owner,
  so a server reachable from the internet should be set up straight after it starts, or started with
  `OWNER_SIGNUP_ENABLED=false` and its owner created with `make owner`. The deploy runbook says so.
- The migration needs no data change. On a database with exactly one owner (every installation)
  it only adds the index. A database with two live owners fails the migration loudly, which
  cannot happen through the application.
- ADR 0004's statement that nobody can claim the account on a fresh server is no longer true
  while sign-up is open; the protection is now the closed state, the switch, and the rate limit.

## Alternatives considered

- **Kilogram as a selling unit.** Rejected by the owner: it changes accounting and needs a ledger
  migration for what is a way of buying.
- **Open registration creating a new shop each time.** Rejected: the product is single-shop, and
  multi-tenancy is a rewrite, not a feature of a sign-up page.
- **A one-time setup token printed by the server.** Safer on an exposed server, but the owner asked
  for a plain sign-up page. The switch and the runbook cover the exposed case.
- **A server-side check of units on every synced record.** Rejected: it would reject offline work
  that was valid when it was recorded.
