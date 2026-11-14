# ADR 0029: Many shops on one server, one database for each shop

Status: accepted on 2026-11-12. It was written in Phase 0 of the multi-shop work (2026-11-12) as a
proposal. The owner read it and then asked in writing for Step 1 ("do step 1"). That is taken as
approval of the design and of the answers that the ADR recommends in "Decisions for the owner": 1 to
6 as recommended, and the stopgap of 7 is not used. Step 1 (the control database) is built; later
steps are built only when the owner asks for them, one at a time. The ADR adds one database (the
control database) and one API module (`shops`, from Step 2). It adds no table to a shop's database,
changes no accounting rule and no stored amount, and it replaces in part the "one shop per server"
sentences of [ADR 0023](0023-owner-self-registration-and-selling-units.md) and
[ADR 0024](0024-account-management.md) (see "Documents that change because of this ADR"). Details
that Step 1 made exact are in "Amendments" at the end.

## Context

Today one server runs one shop: one API process, one PostgreSQL database (`DATABASE_URL`) and one
web address. The owner wants to serve the two shops next to their own from the same server (2 vCPU,
8 GB of memory, 100 GB of disk), and later to offer the app as a subscription: make an account for a
shop, give it an address, bill it each month. They cannot buy one server for each shop.

[docs/MULTI_SHOP_PLAN.md](../MULTI_SHOP_PLAN.md) proposes how. Each shop gets its own database. One
small control database lists the shops and their addresses. The address of a request chooses the
shop. Tokens carry the shop. A switch, `MULTI_SHOP=false`, keeps today's behaviour. The operator of
the server makes the shops and hands out one-time setup codes.

This ADR is the review of that plan before any code is written. It checks the main assumptions
against the real code and the library sources, compares the design with the other ways to do it, and
decides. The answer is yes to one database for each shop. The plan needs eleven corrections (see
"Corrections to the plan"); two of them change what the plan says about security and about rollback.

The project description said "do not build multi-tenant now" (the long-term goal line near the top of
[PROJECT_SPEC.md](../PROJECT_SPEC.md)), and CLAUDE.md said "Not multi-tenant". The same line names a
product for other fabric shops as the long-term goal. Lifting the "not now" is the owner's decision.
They made it by approving this ADR, and both documents were changed to match (see "Documents that
change because of this ADR").

## What was checked

Each fact below has a mark. **Code**: read in this repository on 2026-11-12. **Library**: read in
the source or the documentation of a library; not run. **Assumption**: not proved yet; the step of
the plan that must prove it is named (step numbers are those of
[docs/MULTI_SHOP_PLAN.md](../MULTI_SHOP_PLAN.md)). For this review everything was done by reading
files and library sources. Nothing was changed, migrated or started on the live shop.

### Database access

- **Code.** One class owns all database access. `TransactionHost`
  (`apps/api/src/database/transaction.ts`) is the only holder of the database handle. Its `db`
  getter returns the transaction of the current request when there is one, and the root handle
  otherwise. Repositories use `TransactionHost.db`.
- **Code.** A mutating request is one transaction. `run()` joins a transaction that is already
  open. If none is open, it opens one and first takes the advisory lock
  `pg_advisory_xact_lock(0x66616272)`. `AuditInterceptor` wraps every mutating request in it and
  commits only when an audit entry was written ([ADR 0004](0004-api-foundation.md)). This one lock
  and the one `server_seq` sequence give the commit order that sync depends on
  ([ADR 0002](0002-offline-first.md)).
- **Code.** The API makes one pool at start, from `DATABASE_URL`: `createPool` is
  `new pg.Pool({ connectionString, max: 10 })`. It sets no connect timeout, and no code in the API
  listens for the pool's `error` event.
- **Library** (pg-pool 3.14.0). Idle connections close after 10 seconds by default, so a pool with
  no traffic holds no connections. The default connect timeout is zero, which waits for ever. An
  error on an idle connection is emitted as an `error` event on the pool, and Node throws an `error`
  event that nobody listens to. This was read in the source and not reproduced. It can already stop
  the one process today. With many pools, a problem in one shop's database could stop every shop.
- **Library** (PostgreSQL 16 documentation). An advisory lock belongs to one database, and so does a
  sequence. So each shop database has its own write lock and its own `server_seq` order, with no
  change to the code that uses them.
- **Code.** Migrations are 35 forward-only SQL files in `apps/api/drizzle`. `runMigrations` applies
  them when the API starts, before it listens (`apps/api/src/main.ts`, where a comment says "One API
  instance per shop"). `make migrate` does the same by hand.
- **Code.** Four scripts open the database from `DATABASE_URL` by themselves: `create-owner.ts`,
  `data-import.ts`, `data-export.ts` and `migrate.ts`.
- **Code.** The API has no timers and no scheduled jobs (no `setInterval`, no `@Cron`). The
  `onModuleInit` hooks are synchronous; the one that was read (`StockService`) only registers sync
  handlers and guards. So nothing touches a shop database outside a request, except the start-up
  migration and the scripts above.
- **Code.** In production the API connects with the Postgres container's own user (`POSTGRES_USER`,
  the superuser of that server). Neither the Postgres port nor the API port is published. Only the
  proxy publishes ports (80 and 443).

### The address of a request

- **Code.** Nothing in the API reads the `Host` header or the host name today.
- **Library** (Express 5.3.0). `req.hostname` takes `X-Forwarded-Host` only when the connection
  comes from a trusted proxy, and it removes the port. The API trusts `'loopback, uniquelocal'`
  (`apps/api/src/common/http.ts`), which means every private address and loopback.
- **Library** (Caddy documentation). `reverse_proxy` replaces the `X-Forwarded-*` headers that a
  client sends with its own, and it passes `Host` on unchanged. **Code.** The production Caddyfile
  has one site address, `{$DOMAIN}`, with `default_sni {$DOMAIN}`. It sends `/api/*` to `api:4000`
  with the `/api` prefix removed, and everything else to `web:3000`. So every route at the root of
  the API is public as `/api/<route>`.
- **Code.** `/health` is public, does no database work and answers `{ status: 'ok' }`. Docker's
  `HEALTHCHECK` and the proxy's `depends_on: service_healthy` use it. The check fetches
  `http://127.0.0.1:4000/health` and fails on any answer that is not a success, so a 404 for an
  unknown host would mark the API unhealthy.
- **Library** (Next 16.4.3). In development and in the e2e run, the web server's rewrite proxy sends
  the API its own target as `Host` (`changeOrigin: true`) and the original host in
  `x-forwarded-host`.

### Sign-in

- **Code.** The access token holds `sub`, `role` and `sid` (`claimsSchema` in `token.service.ts`).
  It is signed with HS256 and one secret (`JWT_ACCESS_SECRET`). **Library** (zod 4.6.7). An object
  schema drops keys it does not know, so today's code still reads a token that has an extra claim.
- **Code.** `AuthGuard` reads the session and the user from the database on every request. The
  refresh cookie has no `Domain`, so it belongs to one host name only.
- **Code.** `registerOwner` and the partial unique index `app_user_single_owner` give one live owner
  for each database. `GET /auth/registration` and `POST /auth/register` are public, and the second is
  throttled. `OWNER_SIGNUP_ENABLED` closes them.
- **Code.** The throttler (`@nestjs/throttler` 6.7.1) counts in memory and is keyed by the client
  address only.

### The browser

- **Code.** Each browser origin has its own local database (Dexie, named `fabric-shop`), its own
  service worker cache and its own `localStorage`. The service worker sends `/api/` straight to the
  network.
- **Code.** The local database does not store which shop it belongs to.
- **Code.** When the epoch of the server (a row in `server_instance`) differs from the one the client
  knows, the client keeps its unsent changes and pulls again from the start
  (`apps/web/src/local-db/sync.ts`). When it gets a 401 answer, it refreshes the token once.
- **Code.** The live shop is reached by a bare IP address with a certificate from Caddy's own
  authority (commit 5c41329, and the learning of 2026-11-05 "A server without a domain still needs
  HTTPS"). That learning also records that a browser keeps its local database for each address, so
  moving a device to another address starts it empty.

### Operations

- **Code.** The backup scripts assume one database (`POSTGRES_DB`). The nightly job removes old
  dumps with the pattern `/backups/<database>_*.dump`, so a database named `shop` also matches the
  dumps of a database named `shop_two`. `restore.sh` stops `api` and `web`, restores in one
  transaction, then adds a `server_instance` row so that devices pull again.
- **Code.** The API runbook (`api.md`) already says to take a backup before applying migrations on
  the server, and `deploy.md` repeats it for risky releases. It also records that the release which
  moved stock to batches can be rolled back only by restoring the dump, because the old code cannot
  read the new sales. So restore-based rollback already exists in this repository.

### Structure

- **Code.** `api/common` may not import modules (dependency-cruiser rule
  `api-common-never-imports-modules`), and a module reaches another one only through its `index.ts`.
  `RequestContextMiddleware` lives in `common`. Registration is its own module because `auth`
  importing `settings` made an import cycle (learning of 2026-11-05).
- **Code.** The learning of 2026-11-05 "Sign-up creates the first owner only, then closes" records
  that the owner chose one shop for each server because a shop id on every table and every query is
  "a different project". A database for each shop needs no shop id on any table, so that reason
  does not apply to this design.
- **Code.** The learning of 2026-11-05 "API integration tests need a capped worker count" records
  that each test file opens a pool of 10 connections and one of 2, on a Postgres with
  `max_connections` of 100, and that the suite already hit "too many clients". Tests of many shops
  will open more.

### Assumptions that are not proved yet

- **A1** (Steps 2 and 9). The proxy of the development and e2e servers gives `req.hostname` the host
  that the browser used, so a second shop can be tested at `shop2.localhost:3310`, and the browser
  keeps the cookies of `shop2.localhost` apart from those of `localhost`.
- **A2** (Step 7). The stock `caddy:2.11.7-alpine` image does on-demand certificates with an `ask`
  address as its documentation says. The request that Caddy sends to the `ask` address carries no
  `X-Forwarded-For`. The Let's Encrypt limits are as published (50 certificates for each registered
  domain each week, 5 failed validations for each name each hour). None of this was run.
- **A3** (Step 3). Making a shop and migrating it from nothing takes seconds. The tests already do
  this for every spec file, so it is likely, but it was not measured on the server. _Measured in
  Step 8, on a developer machine: 1.3 to 2.2 seconds for each of 30 shops, 51 seconds for all._
- **A4** (Steps 8 and 10). Three shops fit in one API process on the owner's server. This is an
  estimate, not a measurement. _Measured in Step 8: the limit is the `max_connections` of
  PostgreSQL, not the memory of the API; see the Step 8 amendment, 6. Not yet on the owner's
  server (Step 10)._
- **A5.** A delay of up to 30 seconds before a suspension takes effect is acceptable to the owner.
- **A6** (Step 8). The nightly dump of every shop database and of the control database fits the
  night window. This is estimated from the size of one shop. _Measured in Step 8: 0.17 seconds for
  each database with an empty schema, about 50 MB of database for each second where there is data;
  see the Step 8 amendment, 7. Not yet on the owner's server (Step 10)._

## Decision

### 1. One database for each shop

Each shop has its own PostgreSQL database on the same server. It is named `shop_<slug>` and has
exactly the schema of today: all 35 migrations, `server_seq`, `install_row_guards` and
`server_instance`. No table gets a `shop_id`. A slug matches `^[a-z][a-z0-9_]{2,30}$`. The command and
a CHECK constraint in the control database both enforce this, because `CREATE DATABASE` cannot take
parameters and the name must never come from unchecked input.

Each request works on the database of its shop. `TransactionHost` stays the only holder of database
handles. What changes is where its root handle comes from: the shop that the request is bound to,
instead of one handle for the whole process. The binding is made once for each request, before any
database work, and it is the outermost one. Entering a second shop inside a request throws an error.
This matters because `run()` joins an open transaction: a nested call for another shop would
silently use the transaction of the first shop. Work that has no request (the scripts and the
start-up migration) names its shop explicitly (`SHOP=<slug>`).

Why this and not shared tables:

- Isolation by construction. No query can span two shops, and no query can forget a `WHERE shop_id`.
  Every table, query, index and unique constraint stays as it is.
- The commit-order rule of ADR 0002 stays true for each shop with no change, because the advisory
  lock and `server_seq` belong to a database. With shared tables, one lock would make every shop's
  writes wait for each other, and the `server_seq` numbers of all shops would share one sequence.
- A shop is a whole, standard database. It can be dumped, restored, exported, moved to another
  server, or run alone, with no change to its data.
- The live shop's database becomes shop 1 as it is. Nothing moves and nothing in it changes.
- The accounting, sync and role rules, and their tests, run unchanged, because they run inside the
  database of one shop.

### 2. A control database

A separate database, `fabric_control`, on the same server holds only what is needed to find and run
the shops:

- `shop`: an immutable `id` (uuid), the `slug`, the database name, the state (`provisioning`,
  `active`, `suspended` or `closed`), the time and reason of a suspension, the time of closing, and a
  `label` that is only the operator's own note.
- `shop_host`: one row for each address of a shop, with the host name in lower case (unique among
  the rows that are still in use), the `shop_id`, the time it was made and the time it was released.
- `shop_setup_code`: the hash of a setup code, its shop, its expiry, the time it was used and a
  count of failed tries.
- `shop_event`: an append-only log of what the operator did (who, when, what, which shop).

It never holds what a shop shows or owns: the name shown on screens, the logo and the settings stay
in the shop's own database, so there is only one source for them. It holds no money, customer or
product data.

The control database is not shop data. Its tables are not synced and have no `server_seq` or
`device_id`. They follow the rest of the data rules: nothing is deleted (a host is released, a shop
is closed), a trigger refuses DELETE and TRUNCATE, and `shop.id`, `shop.slug`, the database name and
`shop_host.shop_id` can never be changed after the row is made. This is the one exception to the
rule in CLAUDE.md that every table has the base columns.

It has its own migrations (a separate folder and a separate Drizzle configuration), applied before
any shop's migrations. Only the API process and the operator's commands connect to it.

It is a single point of failure for finding a shop, not for the shops' data. So the API keeps the
answer of each lookup for 30 seconds and, if the control database cannot be reached, keeps serving
from the last answer it has. A host name that the API has never seen fails closed with 503. The plan
said "no cache at first"; that would make every request wait for one more query, and a short break
in the control database would stop every shop.

### 3. The address chooses the shop

In multi-shop mode, the shop is found from the host name of the request: `req.hostname`, put in lower
case and without a final dot, compared exactly with `shop_host`. The code does no wildcard or suffix
matching.

- An unknown host gets 404 with a fixed body that does not say whether the name was ever a shop.
- A suspended shop gets 403 with the code `shop_suspended`.
- A shop that is being made, or whose migration failed, gets 503. Only that shop is affected.
- Only `/health` is outside this rule, because Docker calls it with the host `127.0.0.1`, which is
  no shop's address. `/health` stays as it is: public liveness with no database work. It does not
  report the state of the shops. The operator asks for that with a command (`make shop-list`).

Why the address, and not a path, a header or a field at sign-in: the browser keeps the local database,
the service worker cache, `localStorage` and the refresh cookie for each origin, and the cookie
belongs to one host name. Two shops on one origin would share one local database, and a tablet would
mix their records. A host name gives each shop its own origin, and the browser keeps everything apart
with no code. A port does not: cookies ignore the port, so two shops at `host:8443` and `host:9443`
would share cookies, and `req.hostname` drops the port anyway.

How the host is trusted: `Host` selects a shop, but it never signs anybody in. Every protected route
still needs a valid token for that same shop. The host is read from `req.hostname`, which uses
`X-Forwarded-Host` only from a trusted proxy. That is acceptable, because in production only Caddy
connects to the API and Caddy replaces what a client sends. It is true only while the API port is
never published and never reachable from outside the Docker network. That rule becomes a security
rule of this design, and the deploy runbook must say so.

One shop can have many addresses, and one address belongs to one shop. Shop 1 keeps its bare IP
address as a `shop_host` row. A real host name can be added later as a second row. So no device has
to move, and no device starts empty (see "Offline-first and sync").

### 4. Sign-in and tokens stay inside one shop

The access token gets one more claim, `shop`: the immutable `id` of the shop. For each request the
guard does this, in this order:

1. The address was already turned into a shop by the host step.
2. It checks the signature of the token.
3. It compares `claims.shop` with the shop of the request. A difference gives 401, not 403: the client
   refreshes once on a 401, the refresh also fails, and the person lands on the sign-in page. A 403
   would not do that.
4. Only then does it read the session and the user, from the database of that shop.

Why the claim, when the databases are already apart: an operator will copy shops. A copy made from a
dump has the same user ids and session ids as the original. With one signing secret, a token from the
original would be valid on the copy. The claim closes this.

Recommended and cheap, and to be decided in Step 2 with a test: sign the token of each shop with a key
that is derived from the secret and the shop id (HKDF). A token from another shop then fails the
signature check by construction, and the isolation no longer depends on one comparison that someone
could forget.

The rest does not change. The refresh cookie stays on one host name. The refresh route finds the
shop from the address and looks the session up in that shop's database. Users, sessions, roles and
passwords belong to one shop's database. A person with two shops has two accounts; there is no
account that works across shops.

The throttler key becomes the shop id plus the client address, so that failed sign-ins in one shop
cannot lock out another. A shop's address can also be shared by many tablets behind one internet
address, which is another reason not to share counters.

The answers of login, refresh and registration status also carry the shop id, so that the client can
check it (see "Offline-first and sync").

In single-shop mode the token has no `shop` claim and nothing is compared.

### 5. `MULTI_SHOP=false` is today's server

`MULTI_SHOP` is off by default. With it off: no control database is opened, no host is read, no `shop`
claim is made or checked, registration works as in [ADR 0023](0023-owner-self-registration-and-selling-units.md),
and the API uses the one pool made from `DATABASE_URL`. It behaves as the server of today. The flag is
validated at start with the existing zod check of the environment. With `MULTI_SHOP=true` the process
also needs the secret for setup codes (from Step 6, where it is first used), and it exits when it is
missing. The control database is named by `CONTROL_DATABASE_NAME`; there is no separate URL for it
(see "Amendments").

The proof is the test suite. Every current test must pass with the flag off and no change to the
test. A new suite runs with the flag on.

Tokens in both directions:

- A token made with the flag on has an extra claim that today's code ignores (zod drops it), so
  turning the flag off does not sign anybody out. _Corrected in Step 10: the claim is ignored, but
  the token is signed with the shop's own key (decision 5), which the code with the flag off does
  not use, so every access token made with the flag on gets a 401 once it is off. The client
  refreshes once, as it does when the flag goes on, and nobody has to sign in. See the Step 10
  amendment, 3._
- A token made with the flag off has no `shop` claim, so the first request after the flag goes on
  gets a 401. The client refreshes once, and the refresh route issues a token with the claim, because
  the session of shop 1 is in the database that became shop 1. Users do not notice.

The flag is a switch for the whole server, not for a shop. It is turned on once, in Step 10, after
every check passed.

### 6. Making a shop, and the setup code

Only the operator (the person who runs the server) makes shops, with server commands like
`make owner` today: `make shop-new`, `shop-list`, `shop-suspend`, `shop-resume`, `shop-code` and
`shop-adopt`. This ADR does not add an operator web page or an operator role. A shop's own owner
cannot make shops. The sign-up page never makes a shop; it only lets the holder of a setup code make
the first owner of a shop that already exists. This keeps the line of ADR 0023 that rejected open
registration which makes a shop each time.

`shop-new` is not one transaction, because `CREATE DATABASE` cannot run inside a transaction. So it is
a series of steps. Each step first checks whether it was already done, so the command can be run
again:

1. Insert the control row in the state `provisioning`.
2. Create the database.
3. Run all migrations of the shop.
4. Add the address.
5. Make a setup code.
6. Set the state `active`.

If it fails half way, the row stays in `provisioning` and the command can be run again to continue. It
never drops a database by itself. A shop that waits for its owner is not a stored state: it is an
`active` shop whose database has no live owner, so the fact cannot become wrong.

The setup code is 12 characters from an alphabet of 32 (60 bits), shown once on the operator's
terminal. Only an HMAC of it is stored, made with a secret of the server. It is valid for 7 days, for
one use, and the operator can make a new one. Failed tries are limited for each shop and for each
client address.

Why a code now: a new host name is public from the moment it gets a certificate, because every
certificate is listed in the public Certificate Transparency logs, and anybody can watch these logs.
"The first visitor becomes the owner" ([ADR 0023](0023-owner-self-registration-and-selling-units.md))
was acceptable for the one server of one owner. It is not acceptable when the operator makes shops
for other people and a stranger could claim one within minutes. The learning of 2026-11-05 ruled out
a setup token for the one-shop server. This ADR reverses that for multi-shop mode only.

Registration in multi-shop mode: `GET /auth/registration` tells the page whether the shop of this
address waits for its owner and that a code is needed. `POST /auth/register` needs the code. The order
is: check the code without using it, make the owner (the unique index still guarantees one), then mark
the code used. If marking fails nothing is lost, because the index refuses a second owner. It fails
closed. `OWNER_SIGNUP_ENABLED=false` still closes registration for the whole server, even for a
holder of a code.

`make shop-adopt` makes the live shop into shop 1: it makes the control database, adds a row for the
existing database and its current address, and marks it `active`. It only reads the shop database. It
does not move rows and does not change the schema, so the live shop's data is not touched. The
commands for owner, partner and cashier accounts, export, import, backup and restore take
`SHOP=<slug>` in multi-shop mode.

### 7. Migrations

The control migrations run first, then those of each shop that is not closed, one after the other.
The release has one application version for all shops, because there is one process.

- A lock on each database stops two migrators from running together (for example `make migrate`
  while the API starts).
- If one shop's migration fails, that shop is marked unavailable (503) and the failure is logged. The
  other shops keep serving. The shop is not served by code that expects a schema it does not have.
- Migrations only go forward. So each release follows expand-then-contract: a migration that the
  previous code cannot read is never shipped in the same release as the code that needs it. This is
  what lets the code go back one release without a restore. Some past releases did not follow it
  (see the stock-to-batches release above); each such release will need a restore of every shop to
  go back.
- Before any run that has migrations to apply, the operator takes a dump of every shop and of the
  control database. The API runbook already asks for this for one database.

### 8. Backups and restore

- Each shop has its own directory of dumps (`/backups/<slug>/<database>_<UTC time>.dump`), and the
  control database has its own. The old pruning pattern would mix `shop` and `shop_two`, so pruning
  works on each directory alone.
- The nightly job reads the list of shops from the control database and dumps every shop that is not
  closed, suspended ones included, then the control database.
- `make backup-verify` restores a fresh dump of each shop into a scratch database and compares row
  counts, as it does today.
- Restoring one shop, in the first version, uses the same script as today. It stops `api` and `web`,
  so every shop is offline for a few minutes while one shop is restored. The tablets keep selling
  offline ([ADR 0002](0002-offline-first.md)), so the cost is small. A later change can suspend only
  that shop and restore it while the API runs. This ADR does not build that.
- After a restore the shop gets a new `server_instance` row, so its devices pull again from the start
  and keep their unsent changes, as today.
- Rotating `JWT_ACCESS_SECRET` signs out every shop at once, because the secret is shared.

### 9. Suspending a shop

`make shop-suspend` sets the state `suspended` with a reason and a time. `make shop-resume` reverses
it. The command runs outside the API process, so the change is seen within the 30 seconds of the
lookup cache.

A suspended shop answers every route except `/health` with 403 `shop_suspended`: sign-in, refresh and
sync included. Nothing is deleted and nothing is changed. Its data stays, and the nightly backup
still includes it.

What suspension does not stop: a tablet that already has the app keeps working from its local
database, keeps selling, and queues its changes. When the shop is resumed, they sync. This is on
purpose. A sale at the till must never be lost or blocked by a billing state. The app should show a
clear notice when the server answers `shop_suspended` (a later screen, with its texts in both
languages). It must never clear local data and never block the till. So suspension stops the
server's side (sign-in, sync, new devices); it is not a remote lock of the till.

`closed` ends a shop for good. Its address stops answering and its data stays on the server. Removing
a database is a separate manual decision of the operator and the owner, after an export. This ADR
does not do it: there is no hard delete anywhere.

### 10. Security boundaries

- **Shop data apart from shop data.** Kept by: a database for each shop, one pool for each shop, and
  a binding that is made once for each request and cannot nest. Not stopped: a bug that binds the
  wrong pool, or a captured API process, because the API holds the login for every shop database.
  The isolation is structural. The database does not enforce it.
- **Shop sessions apart.** Kept by: the `shop` claim (and, if chosen, a key for each shop), sessions
  in each shop's database, and a cookie for one host name. Not stopped: a leak of the signing secret.
- **Operator apart from shop users.** Kept by: operator commands that run only on the server, and no
  operator route in the API. Not stopped: anybody who has a shell on the server.
- **Certificates.** Kept by: on-demand certificates only for names that the `ask` address approves.
  Not stopped: a name that is approved by mistake.

Notes on these:

- **Isolation is structural, not enforced by the database.** The API uses one login (the Postgres
  superuser) for all databases. The plan said "a query cannot reach another shop's rows at all"; that
  is true only while the binding is right. Answers: a binding that is made once and cannot nest, a
  test that signs in to two shops and proves that neither can read the other (Step 9), and, later and
  optional, a database login for each shop with the right to connect to its own database only. That
  last step needs separate roles for migrations and for running, so it is not part of the first
  release. A dump that is restored by mistake into the wrong database is a procedure risk, and the
  restore command must name the shop.
- **The `ask` address.** On-demand certificates must be limited with `ask`. Without it, anybody could
  point a name at the server and make Caddy ask for certificates until the Let's Encrypt limits are
  used up. The plan put the `ask` route "not under /api". That does not work. Caddy removes the `/api`
  prefix, so a route `/internal/known-host` on the API is public as `/api/internal/known-host`.
  The fix has two layers. The site block of Caddy answers 404 for `/api/internal/*`, and the route
  refuses any request that has an `X-Forwarded-For` header, because every request that comes through
  the proxy has one. Caddy's own `ask` request goes straight to `http://api:4000/internal/known-host`
  on the Docker network and does not pass the site block (A2). The route answers 200 only for the
  names of shops that are not closed, and 404 for IP addresses, so the bare-IP site of shop 1 keeps
  its present certificate. Wildcard certificates are not used: they need a DNS plug-in that the stock
  Caddy image does not have.
- **Pools.** Every pool gets an `error` listener. The pools that multi-shop mode makes also get a
  connect timeout of 10 seconds; the pool of a one-shop server does not (see "Amendments" for why). A
  pool for a shop is made on first use, with a smaller `max` than today (5), and holds no connection
  while it is idle. The total (shops × `max`, plus the control pool, a migration and a backup) must stay below
  Postgres' `max_connections`. The missing `error` listener is a gap that exists today, whatever
  happens with this ADR, and it is reported separately.
- **Logs** carry the shop slug of the request, and never data of another shop.

### 11. Where the code goes

- `apps/api/src/database/`: `ShopPools` (slug to pool, made on first use; each URL is `DATABASE_URL`
  with the database name of the shop, on the same server and with the same login), the binding of a
  request (an AsyncLocalStorage store that `TransactionHost.db` reads), and `createPool` with the
  timeout and the `error` listener.
- `apps/api/src/modules/shops/`: the control repository, the lookup with its cache, making shops,
  setup codes, the host step and the `ask` route. It is public only through its `index.ts`.
- The host step is registered in `app.module.ts`, which may import module indexes. It cannot live in
  `common/request-context.ts`, because `common` never imports modules. The plan said that
  `RequestContextMiddleware` finds the shop; that cannot be built under the rules of this repository.
- `AuthGuard` reads the shop of the request from the binding in `database/`, not from the `shops`
  module. This avoids the kind of import cycle that the registration module was made to avoid.
- `packages/contracts`: the `shop` claim and the additions to the registration status and request.
  `apps/web`: a field for the setup code on the sign-up page, the notice for `shop_suspended`, and
  the shop check of the client, with every text in `ar.ts` and `en.ts`. The sync protocol and
  `SYNC_ENTITIES` do not change.
- The four scripts and the `make` targets take the shop explicitly.

## Offline-first and sync

The wire format of sync does not change. Each shop's database has its own `server_seq` and its own
epoch, and the client talks to one address, so it talks to one shop. Offline work, the outbox and the
pull cursor behave as in [ADR 0002](0002-offline-first.md).

What the plan missed is that the local database does not know which shop it belongs to. If an
address were ever pointed at a different shop, a device would see a new epoch, reset its cursor,
pull the other shop's data into its local database, and push its own unsent changes into the other
shop. Three answers, together:

- A rule of the server: `shop_host.shop_id` can never change. An address is released, never moved.
- Recommended: the client stores the shop id when it first signs in. It stops syncing, and says why,
  when the server answers with another id. With no id from the server (flag off) it checks nothing.
- A rule for the operator: never give a released name to another shop while old devices may still
  use it.

Moving a device from one address to another (for example from the IP to a host name) starts it with
an empty local database, and the unsent changes of the old origin stay behind. So the old address stays
mapped to the same shop as a second `shop_host` row, and devices move only after a full sync.

If the control database is down, devices that are online keep working from the cached lookup, and
devices that are offline do not notice. A suspended shop's tablets keep working offline (see above).
The service worker, which sends `/api/` straight to the network, is made for each origin, so every
shop's address installs its own.

## Corrections to the plan

The structure of the plan stays: a database for each shop, a control database, the address as the
key, the flag, adopting the live shop, setup codes, a backup for each shop. These parts change:

1. **Isolation.** The plan said a query cannot reach another shop's rows at all. It is structural, not
   enforced by the database (see the security section). Tests and a binding that cannot nest are the
   answer.
2. **No cache.** A short cache with serve-stale is needed (see the control database).
3. **The `ask` route.** It is not hidden by being outside `/api`. Caddy must block it for the public
   and the route must refuse proxied requests.
4. **`/health`.** The plan said it shows the failed shop. It is public liveness with no database work
   today, and Docker calls it with the host `127.0.0.1`. It stays so, and it is outside the host
   rule; under the host rule it would get a 404 and Docker would mark the API unhealthy. Per-shop
   state comes from a command.
5. **Backups.** The plan was right that the list of shops comes from the control database. The
   pruning pattern of the nightly job would mix `shop` and `shop_two`. It needs a directory for each
   shop, and the control database must be dumped too.
6. **Where the shop is found.** Not in `RequestContextMiddleware`, which is in `common`. It is a step
   from `modules/shops` that `app.module.ts` registers.
7. **Sync does not change.** True for the wire format. The client still needs a shop check, and a
   change of address strands the old outbox.
8. **Setup codes.** They are required in multi-shop mode, not an option. "Waiting for its owner" is
   derived from "no live owner", not stored.
9. **Certificates.** One certificate for each name, made on demand with `ask`. A wildcard DNS name is
   fine for addresses, but a wildcard certificate is not available with the stock Caddy image. The
   Let's Encrypt limits apply to the number of shops made in a week (A2).
10. **Restore.** It is not a restore of one shop alone at first: it stops every shop for a few
    minutes.
11. **Rollback.** "Turn the flag off" is enough only until a migration that the old code cannot read
    has run, and only while no neighbour's address still reaches the server (see "Rollback").

The plan file is not edited now. After the owner approves this ADR, the plan is updated to match it.

## Consequences

What gets better:

- Isolation without touching every table and query, and without the risk of a forgotten filter.
- Accounting, sync, roles and period locks, with all their tests, stay as they are.
- A backup, restore, export or move for each shop alone. A shop can leave this design by dump and
  restore, with no change to its data.
- The live shop is not touched. The way back is short.

What it costs:

- Operations grow with the number of shops. Each release migrates and each night dumps every
  database. For tens of shops this is seconds and minutes.
- One process serves all shops, so a crash, a bug or a deploy reaches all of them. The offline tablets
  keep selling, which makes this less harmful than in an online-only product. The pool limits,
  timeouts and listeners are there to keep one shop from harming the others.
- All shops run one version at the same time. No shop can be rolled forward or back alone.
- Connections multiply with the shops. Idle pools hold none, but the limit must be watched. Above
  about 15 shops, with pools of 5 and Postgres' default of 100, `max_connections` must be raised or a
  connection pooler added.
- No SQL query spans shops. Numbers across shops (how many shops, when each last synced) come from
  an operator command that asks each database. The product needs no report across shops.
- The control database is a single point of failure for finding a shop. The cache answers that for
  its time, and its backup is part of the nightly job.
- The isolation is not enforced by the database.

The size of the design: it suits tens of shops on one Postgres server. More shops, or a need for
reports across shops, would be the time to look again (schema-per-shop with a pooler, or several
servers that share one control database).

Risks and their answers:

- **A bug binds the wrong shop.** One binding for each request that cannot nest; a two-shop test
  (Step 9); a key for each shop (Step 2).
- **An error on a pool stops the process for all shops.** An `error` listener on every pool, and a
  connect timeout on the pools of multi-shop mode.
- **Connections run out.** A small `max` for each shop; the total checked at start; the pools of the
  test suite lowered.
- **The control database is down.** A 30-second cache that serves the last answer, and a nightly
  dump.
- **A migration fails for one shop.** That shop gets 503 and the others serve; a dump of every shop
  is taken before the run.
- **Dump files of two shops collide.** A directory for each shop.
- **Certificates are abused or rate-limited.** `ask` is required, Caddy blocks `/api/internal/*`,
  and the shops made in a week stay below the limit.
- **An address points at another shop.** `shop_host.shop_id` never changes; the shop check of the
  client; the rule for the operator.
- **A device changes address and starts empty.** The old address stays mapped, and a full sync comes
  before the move.
- **A stranger claims a new shop.** The setup code is required in multi-shop mode.
- **The adoption of the live shop goes wrong.** `shop-adopt` only reads the shop database, a dump is
  taken first, and the flag stays off until Step 10.
- **The flag goes off while a neighbour's address still reaches the server.** Close the neighbours'
  addresses at the edge first (see "Rollback").

## Rollback

- **Before Step 10.** Steps 1 to 9 add code behind the flag, a control database and tests. The flag is
  off, so the live shop runs as before. To go back, do not turn the flag on. The code can be reverted,
  and the control database can be left or removed by hand. No live data is involved.
- **After the flag is on, with shop 1 only.** Set `MULTI_SHOP=false` and restart, or start the
  previous image. The database of shop 1 was never changed. Each device's access token gets one 401
  and is renewed with its refresh cookie, so nobody signs in again (Step 10 amendment, 3).
- **After shops 2 and more exist.** Turning the flag off removes access to them. Nothing is lost,
  because each is a whole database. Before doing so, close their addresses at the edge (take them out
  of Caddy or DNS). With the flag off the server does not read `Host`: it would serve shop 1 under
  any name that still reaches it. A device of shop 2 would then reach the database of shop 1. It
  cannot sign in without a shop 1 account, but if the same user name and password exist in both
  shops, it could. Each shop can later run alone in its own stack from its dump.
- **After a migration that the old code cannot read.** Going back needs a restore of each shop from
  the dump taken just before the migration, and what was written after it is lost on the server. This
  has happened before in this repository (the stock-to-batches release). It is why releases should
  follow expand-then-contract, why the dump is taken before the run, and why the run is done when the
  shops are closed.
- **Leaving the design.** A dump of each shop restores into its own single-shop stack with no change.

## Alternatives considered

- **Shared tables with a `shop_id` on every table, with or without row-level security.** One pool,
  the cheapest for each shop, and reports across shops are easy. But it changes every table, query,
  index and unique constraint; the single write lock and `server_seq` would make shops wait for each
  other and share one sequence; one forgotten filter shows one shop's data to another; and row-level
  security needs a setting for each transaction and a database user that is not a superuser. The
  learning of 2026-11-05 already called this "a different project". Rejected.
- **One schema for each shop in one database.** The isolation is weaker than a database, the advisory
  lock key would be shared by every schema in that database unless it is changed, the search path
  must be set on every checked-out connection, and it gains little over a database for each shop.
  Rejected.
- **One full stack for each shop (a compose project each, with a front proxy that routes by host).**
  No code change, the strongest separation of crashes and releases, and each shop deploys and rolls
  back alone. But it costs memory for an API and a web server for every shop, one `.env`, one backup
  job and one set of ports for each, work by hand for every new shop, no sign-up and no central
  view. It does not become a service for many shops. It stays as a stopgap if the two neighbouring
  shops must start before this build is finished: their databases can later be moved into this
  design with a dump and a restore. Not chosen as the design.
- **One server for each shop.** The strongest and the most costly. The owner has said they cannot buy
  a server for each shop.
- **Managed PostgreSQL or a connection pooler.** Not needed at tens of shops. Look again when
  connections are the limit.
- **The shop chosen by a path, a header or a field at sign-in.** Rejected: one origin would share the
  local database, the service worker and the cookies of several shops.
- **The list of shops in a file, or in the database of shop 1.** A file cannot make shops while the
  server runs and has no log. Tables in shop 1's database would tie every shop to shop 1: restoring
  shop 1 would roll back the list. Rejected.

## Relationship to earlier decisions

- **ADR 0023.** With `MULTI_SHOP=false` it stays exactly as it is. In multi-shop mode its rule "the
  first owner, then closed" holds for each shop, with the partial unique index in each shop's
  database, and the registration gets a setup code. Its sentences "one shop per server" and "No
  multi-shop isolation" are superseded in part. It rejected open registration that makes a shop each
  time; this ADR keeps that: only the operator makes shops. It already says "one database per shop",
  which is the unit of this design.
- **ADR 0024.** Accounts stay owned by the server and online only. A partner account belongs to one
  partner in one shop's database. Its note that "the shop id joins the partial unique index" is not
  needed: with a database for each shop, no index needs a shop id.
- **ADR 0004.** The one-transaction rule and the audit entry apply in the shop's database. What the
  operator does is written to `shop_event`, not to a shop's `audit_log`.
- **ADR 0002, 0005, 0007.** Commit order, period locks and the roles (a cashier never sees a cost or
  a profit) hold for each shop with no change.
- **The learnings of 2026-11-05** on sign-up, on the bare IP, on the export list and on the test
  connection limit are used above. The one on setup tokens is reversed for multi-shop mode, with the
  reason given in section 6.

## Documents that change because of this ADR

Changed in Step 1:

- `CLAUDE.md`: the first paragraph (it said "Not multi-tenant") and a data rule for the control
  database.
- `docs/PROJECT_SPEC.md`: the long-term goal line (it said "do not build multi-tenant now"). The
  owner's approval of this ADR is the approval for this change. The line is the owner's own text, so
  they can ask for it to be changed back.
- `docs/adr/0023` and `docs/adr/0024`: a note "Superseded in part by ADR 0029" on the sentences named
  above. Their history stays.
- `docs/accounting-assumptions.md`: row OS4.
- `docs/MULTI_SHOP_PLAN.md`: rewritten to match this ADR, with Step 1 marked done.
- The comment in `main.ts` that said "One API instance per shop" and the one in `compose.prod.yml`
  that said "Single API instance".
- `.env.example`, `compose.dev.yml` and `compose.prod.yml`: the two new settings.

Changed in the step that needs them:

- `CLAUDE.md`: the login rules (Step 2) and the commands table (`SHOP=<slug>` and the `shop-*`
  targets, Steps 4, 5 and 8).
- `docs/runbooks/deploy.md` (size for the number of shops, a host name for each shop, shared version
  and rollback), `backup.md` (a directory for each shop, restore stops every shop at first),
  `api.md` (first start with setup codes, migrations for each shop), and a new `shops.md`.
- `docs/MVP_ACCEPTANCE.md`: a multi-shop acceptance run.

## Decisions for the owner

Answered on 2026-11-12 by the owner's message "do step 1": decisions 1 to 6 as recommended. Decision
7, the stopgap, is not used.

1. **Approve the design:** one database for each shop and one control database. This also lifts "do
   not build multi-tenant now" (PROJECT_SPEC.md) and "Not multi-tenant" (CLAUDE.md) for this design.
   Recommended: approve.
2. **Addresses.** Shop 1 keeps its IP address as an address of its own for good. Shops 2 and 3 need
   host names: one domain, with one name for each shop, is enough. Recommended: buy a domain, and do
   not move the devices of shop 1.
3. **Restore.** Accept that restoring one shop stops every shop for a few minutes until a restore of
   one shop alone is built. Recommended: accept.
4. **Suspension.** Accept that it stops the server's side (sign-in, sync, new devices), and that a
   till that is already open keeps working offline and syncs later. Recommended: accept; a till is
   never blocked.
5. **Setup code.** Accept a setup code for the first owner in multi-shop mode. It reverses, for that
   mode only, the decision of 2026-11-05 against a setup token. Recommended: accept.
6. **Shop check in the client.** A small change in the contracts and the web app that stops a device
   from mixing two shops. Recommended: approve, with Step 2.
7. **Stopgap.** If the two shops must start before the build ends, a separate stack for each is
   possible now (see the alternatives). Recommended only if the date matters.

This ADR does not decide: a database login for each shop, an operator web page, a restore of one
shop alone, billing and plan limits, the notice screen for a suspended shop, or the management of
custom domains. Each needs its own decision when it is wanted.

## Amendments

### 2026-11-13: Step 1, the control database, was built

Building Step 1 made some details of this ADR exact. The decision itself did not change.

1. **The settings.** Multi-shop mode is turned on by `MULTI_SHOP=true`, and it is off by default. The
   control database is named by `CONTROL_DATABASE_NAME` (default `fabric_control`). There is no
   `CONTROL_DATABASE_URL`. The control database is always on the same server and uses the same login,
   so the API takes `DATABASE_URL` and replaces only the database name; a second URL could only
   disagree with the first. The name must be a plain lower-case database name, and it must not be the
   database in `DATABASE_URL`. The API refuses to start otherwise. `.env.example` documents both
   settings and the compose files pass them to the API. The name of the secret for setup codes is
   chosen in Step 6, where it is first used.
2. **The connect timeout belongs only to the pools of multi-shop mode.** Section 10 said that every
   pool gets a connect timeout. The source of pg-pool 3.14.0 shows that this timeout also limits how
   long a request waits for a free connection when the pool is full, not only the time to open a new
   connection. A mutating request keeps its connection while it waits for the write lock, so on the
   one pool of a one-shop server a burst of writes could turn a short wait into an error. That would
   change how today's server behaves, and `MULTI_SHOP=false` must not do that. So every pool gets an
   `error` listener, which also closes the gap that exists today, and the timeout of 10 seconds is set
   only on the pools that multi-shop mode makes: the control pool now, and the shop pools in Step 2.
   The pool of a one-shop server is as it was.
3. **Making the control database.** When `MULTI_SHOP=true`, the API (and `make migrate`) makes the
   control database on the server of `DATABASE_URL` if it is missing. It migrates the control
   database first and the shops after it. The login must be allowed to create databases; the
   superuser of the Docker stack is. Two processes that start together can both try. PostgreSQL then
   tells the one that loses in one of two ways: "database already exists", or a unique violation on
   its catalog index of database names. Both mean that the database exists, and both are accepted. A
   test found the second way. The control migrations are in `apps/api/drizzle-control`. That folder
   is listed in the `files` of `apps/api/package.json`, because the production image is made from the
   files listed there and would not contain the control migrations otherwise.
4. **The rules of the control tables, as built.** Added to section 2: what identifies a row never
   changes after it is made. That is `id`, `slug`, `db_name` and `created_at` of a shop; `id`, `host`,
   `shop_id` and `created_at` of an address; and `id`, `shop_id`, `code_hash`, `expires_at` and
   `created_at` of a setup code. A closed shop cannot be opened again. A suspended shop must have a
   suspension time and a closed shop a closing time. A host is a lower-case DNS name or IPv4 address,
   with no port and no final dot, and it is unique among the hosts that are still in use. A slug and a
   database name must match the patterns of section 1 in the database as well as in the code. A test
   fails for any table of the control database that has no guard against DELETE and TRUNCATE.

### 2026-11-13: Step 2, the tenant router, was built

Building Step 2 made more details of this ADR exact. The decision itself did not change.

1. **Tokens are signed with a key for each shop.** Section 10 left this open. It is decided: yes. The
   key is HKDF-SHA256 of the server's secret, with an empty salt and the text
   `fabric-shop/access-token/<shop id>`, 32 bytes, kept in memory for each shop. The token also
   carries the shop id in a `shop` claim, and the claim is compared with the shop of the request after
   the signature is checked. The two checks are separate, and each has its own test. A token signed
   with the key of shop A that names shop B fails the signature at shop B. A token signed with the
   right key of shop B that names shop A passes the signature and is refused by the claim check, with
   its own message. When the claim check is removed, the second test fails. The key costs nothing at
   run time. Its text is now part of the token format: changing it signs every device out once.
2. **The comparison is in `TokenService`, not in `AuthGuard`.** Sections 10 and 11 said that
   `AuthGuard` reads the shop of the request from the binding. The guard has no token logic: it
   calls `TokenService.verifyAccess`, and that is the one place that makes and checks a token, so the
   key and the claim are there. `TokenService` reads the binding from `database/`, so there is still
   no import of the `shops` module. The guard is unchanged. The order is as planned: the host step has
   run, the signature is checked, the claim is compared, and only then is the session read from the
   shop's database. A token made before this step has no claim and a different key, so it is refused
   once with 401, and the app refreshes with its cookie by itself. A test shows that.
3. **The host step is registered by `ShopsModule`, not by `app.module.ts`.** Section 11 said that
   `app.module.ts` registers it. `app.module.ts` now imports `ShopsModule` only when
   `MULTI_SHOP=true`, because the module opens the control database and a one-shop server must not
   have one. The module registers the step for every route except `/health`. It comes after the
   logger and before every other module, and middleware runs before guards and interceptors, so a
   request is bound to its shop before any of them run. The OpenAPI page (`/docs`) is set up before
   the step. It shows no shop's data, and it is as public as it is on a one-shop server.
4. **What each answer is, as built.** An address that no shop uses, an address that was released, and
   a closed shop all give the same 404 with the same body, so a caller cannot tell them apart. A shop
   that is suspended gives 403 with the code `forbidden` and the issue code `shop_suspended`
   (`SHOP_ISSUES.suspended`), the same pattern as `account_deactivated`. A shop that is being made
   gives 503 with the new error code `service_unavailable`, which is also what a request gets when the
   list of shops cannot be reached and its address was never seen. The address is `request.hostname`:
   the `Host` header without its port, or the `X-Forwarded-Host` of a proxy that the server trusts.
   The Next proxy of dev and e2e sends the browser's `Host` as `X-Forwarded-Host` (checked in the
   source of Next 16.4.3, `proxy-request.js`). No other header, path or token can choose the shop.
5. **The lookup.** An answer is trusted for 30 seconds. The cache holds at most 1000 addresses and
   drops the one answered longest ago, because anybody can send any `Host` header. A name that can
   never be an address (it does not match the rule of the control table) is answered "unknown" without
   a read. A burst of requests to one address that is not cached makes one read. After a failed read the
   control database is not tried again for 5 seconds, so requests do not queue behind a database that
   is down; an address that was answered before keeps its last answer, and an address never seen
   gives 503. A test takes the control database down and brings it back.
6. **Pool size is a setting.** The plan fixed 5 connections for a shop pool. It is the default of a
   new setting, `SHOP_POOL_MAX` (1 to 20), because the total (shops in use times this number, plus 3
   for the control database) must stay under `max_connections`, and the operator knows that limit. The
   test suite uses 2. `ShopPools` replaces the `DB` and `PG_POOL` tokens: nothing else used them. In
   one-shop mode it makes the one pool of `DATABASE_URL` when it starts, exactly as before; in
   multi-shop mode it makes a pool for a shop on first use.
7. **`runAsShop(slug, work)`** is `ShopsService.runAsShop`, in `modules/shops`. It finds the shop by
   slug and binds it. A shop that is being made or is suspended can be worked on, because an
   operator's command must reach it. A closed or unknown shop cannot. It cannot nest.
8. **The rate limiter** counts each client address once for each shop (`ShopThrottlerGuard`). A test
   with two shops and one client address shows that the wrong guesses at one shop do not use the
   other shop's allowance.
9. **The client.** A device keeps the shop id of its first sign-in that names one (the `meta` key
   `shopId`), and checks it on sign-in, on refresh and on the sign-up status. A different id throws
   `WrongShopError`. Nothing of that answer is kept and the device is not signed out; the sync state
   is `wrong_shop`, which has a badge in the header and a notice in the sync settings, in both
   languages. The sign-up asks the status first, so that no account is made on a shop that the device
   does not belong to. Signing out keeps the id, as it keeps the local data. A server that names no
   shop is never checked. One limit remains: a device that signed in on a one-shop server holds no id,
   so if its address is later given to another shop, the first id it sees is kept as its own.
10. **Logs** carry the slug of the shop on each request line (`shop`), as section 10 asked.

### 2026-11-13: Step 3, migrations for every shop, was built

Section 7 is built as written, with these details made exact.

1. **One migrator at a time, by a lock on the database.** A migrator takes `pg_advisory_lock` with the
   key `MIGRATION_LOCK` (ASCII "migr") on a connection of its own and holds it while Drizzle works.
   It first tries the lock, and if another migrator has it, it says so (`onWait`) and waits. The lock
   belongs to the connection, so it is freed when the connection closes, even if the process dies.
   It is not the write lock of ADR 0002: that one is taken for a moment by every write, and a
   migration must not wait behind the writes of a shop, nor make them wait. The lock is needed because
   Drizzle reads which migrations are applied before it opens its transaction, so two migrators that
   start together both run the same ones. A test with three migrators shows each migration is applied
   once, and taking the lock out makes it fail. The lock is in `runMigrations`, so the one-shop server
   has it too: `make migrate` while the API starts is safe there as well. Nothing else about that
   server changes.
2. **Which shops, in which order.** The control database first, then every shop that is not closed
   (`active`, `suspended` and `provisioning`), one after the other, in the order they were made. A
   suspended shop is migrated because a resume must not meet an old schema. A shop being made whose
   database does not exist yet is skipped with a log line, never given a database by a migration:
   `shop-new` (Step 5) makes it and then migrates it. A closed shop is not touched. In multi-shop mode
   the start-up no longer migrates the database of `DATABASE_URL` itself. That URL is the server and
   the login, not a shop. The live shop must be listed in the control database (Step 4) or nothing
   migrates it.
3. **A failure of one shop.** It is logged as an error with the database's own message (not the whole
   statement, which Drizzle puts in its error) and the start goes on. Drizzle applies all pending
   migrations of one database in one transaction, so a failure leaves the shop's schema as it was.
   The control database is different: if its migration fails, the server does not start.
4. **"Marked unavailable" is a fact asked of the database, not a flag.** The text of section 7 said
   the shop is marked. A flag in memory would last until a restart, and a state in the control database
   could be wrong after a restore. So `ShopSchema` asks the shop's own database whether the newest
   migration of this code is applied. This is the rule Drizzle uses to decide what is pending: the
   newest `created_at` in `drizzle.__drizzle_migrations`. `ShopLookup` makes the check part of its
   30-second answer for a shop it would serve. A shop that is behind answers 503
   `service_unavailable` ("This shop is being updated"). It is served again by itself within 30
   seconds of the cause being removed and the shop being migrated again, with no restart. The same check
   also stops a shop that was never migrated, or that was left behind by `MIGRATE_ON_START=false`. A
   database that is ahead of the code is current, so the code can go back one release. If the shop's
   database cannot be asked at all (it is down), the shop is served: a request to a database that is
   down fails on its own, and a fault in this check must not stop every shop. The price is two small
   queries for each shop every 30 seconds for each address in use.
5. **`make migrate SHOP=<slug>|all`.** With `MULTI_SHOP=true` the command must name its shop, as the
   ADR said of all commands without a request: a slug, or `all` for every shop that is not closed.
   Without it the command prints its usage and exits with 2. With the flag off `SHOP` is refused
   (exit 2) and the command is what it was. Every shop asked for is tried, and the exit code is 1 if
   any failed or the slug is not an open shop. So the slug `all` is reserved: `shop-new` must refuse
   it.
6. **Expand-then-contract and the dump** are rules for the people who release and run, and no code
   enforces them. They are now in the API runbook with the way to fix a failed shop. `make backup`
   for each shop arrives with Step 8, until then the dump before a migration is the one `make backup`
   makes.
7. **Assumption A3 is measured, on a laptop.** Making a database and applying all 35 migrations took
   0.6 to 1.1 seconds in four runs, against a PostgreSQL 16 container. It was not measured on the
   server. Each shop's log line says how long its migration took, so the real figure is in the log at
   Step 10.

### 2026-11-13: Step 4, adopting the live shop, was built

Section 6 (the rollout) is built as written, with these details made exact.

1. **It runs with the flag off.** The rollout adopts the shop first and sets `MULTI_SHOP=true`
   after, so the command must work on a server that is still a one-shop server. The command
   (`shop-adopt.ts`) builds its configuration with the flag forced on (`loadConfig({ MULTI_SHOP:
'true' })`), and `adoptShop` refuses a configuration with it off. The running server is not
   touched, and neither is its environment.
2. **The shop's database is the one `DATABASE_URL` names**, as the plan said (`POSTGRES_DB`). It is
   looked at through a session that the server holds read-only (`default_transaction_read_only=on`),
   so a write added there by mistake fails instead of changing a live shop. The command reads one
   fact from it: how many migrations are applied. A test takes a fingerprint of every table of the
   shop before and after and finds them equal, and it fails if the session is made writable and a
   write is put in.
3. **A database that is not a shop's is refused before anything is made.** If `drizzle.__drizzle_migrations`
   is not there, the command stops: the usual cause is a wrong `DATABASE_URL`, and adopting an empty
   database would give an address to a shop with no schema. The control database is made only after
   this check, so a wrong URL makes nothing.
4. **Three rows, one transaction.** `shop` (state `active`), `shop_host` and `shop_event`
   (`shop.adopted`, with the address, the database and the number of migrations applied; the actor is
   the operator's login on the server, `id -un`). The transaction takes an advisory lock (ASCII
   "adop") so two adoptions cannot interleave. The shop's `audit_log` is not written: it is not
   touched.
5. **Again is safe, and a conflict is refused with the reason.** The same shop with the same address
   writes nothing and says `already`. The name of another shop, a database that is already another
   shop, an address that belongs to another shop, a reserved name (`all`, `www`, `api`, ...), a name
   or an address that cannot be used (a scheme, a port, a path, upper case turned to lower case) are
   all refused before anything is written. A new address for a shop that is adopted already is also
   refused: adding an address is Step 5's, and adopting must not change a shop that exists. The
   slug and address rules are the control database's own (`SHOP_SLUG_PATTERN`,
   `SHOP_HOST_PATTERN`, `RESERVED_SHOP_SLUGS`, now exported from `control/schema.ts`), so `shop-new`
   uses the same ones.
6. **A fault of Step 1 was found and fixed.** The control migrations did not take the migration
   lock of Step 3. Two commands that prepare the control database at the same moment (an adoption
   while the API starts) could both try `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations`
   and one died on a unique-key error of the catalog. `withMigrationLock` (in `migrate.ts`) now
   serves both the shops and the control database. A test starts two together; without the lock it
   fails.
7. **"The whole existing suite" is the suite itself, run as an adopted shop.** `createTestApp`
   switches mode with `TEST_SHOPS=adopted` (`pnpm --filter @fabric/api test:e2e:adopted`,
   `vitest.adopted.config.ts`): it adopts the test's database as `shop_one` at `127.0.0.1`, the
   address supertest uses, and starts the server with the flag on. A spec's calls to a service
   (`app.get(Service)`) are bound to that shop one call at a time, because in multi-shop mode a
   service has no shop outside a request. No spec file was changed. The browser suite does the same
   with `E2E_SHOPS=adopted` (`global-setup.ts`: it adopts the shop with the address `127.0.0.1`, then
   restarts the API with the flag on).
8. **Tests that assert what only a one-shop server does are skipped, each with its reason, and
   none was edited.** The skip is a hook (`test/support/one-shop-only.ts`) that matches the full
   test name, because a name pattern given to Vitest runs every test of a block whose own name
   matches. These are the cases: the block that tests `MULTI_SHOP` off (two tests); four tests that
   assert the exact JSON `{ open }` of the sign-up status, which in multi-shop mode also carries
   `shopId` (Step 2's contract, which the owner approved); and one that counts an attempt made by the
   test before it. The multi-shop shape of the status is tested in `test/shop-adopt.e2e-spec.ts`.
   The browser suite has the same case for one test (see the plan). If the owner wants no skip, the
   fix is to compare with `toMatchObject` in those specs, which is a change to the specs and is
   therefore the owner's to ask for.
9. **Not tried on a restored real backup.** No real backup was at hand. The path is the one of
   `make backup-verify` and `docs/runbooks/backup.md`: restore a dump into a scratch database, point
   `DATABASE_URL` at it and run the command. Step 10 does it with the live shop's dump before the
   flag is turned on.

### 2026-11-13: Step 5, creating and managing shops, was built

Section 9 (the operator's commands) is built as written, with these details made exact and three
additions that the plan did not list (items 8, 9 and 10).

1. **Server commands only.** One program, `shop.ts`, runs `new`, `list`, `suspend`, `resume`,
   `code`, `host` and `close` (`make shop-new` and its siblings, each `docker compose exec -T api
node dist/shop.js <command> … --actor "$(id -un)"`). The rules are in `shop-commands.ts`; the work
   is in `database/shop-provisioning.ts`, `shop-management.ts`, `setup-code.ts` and `shop-names.ts`.
   There is no route, no role and no web page for it. Like `shop-adopt` it forces `MULTI_SHOP` on in
   its own configuration, so shops can be made before the flag is turned on. Exit codes: 0 done or
   done already, 1 refused or failed (the message says why), 2 used wrongly.
2. **`shop-new` is five steps, and each looks at whether it was done.** The control row
   (`provisioning`), the database (`ensureDatabase`, which tolerates two sessions racing), the
   migrations (`runMigrations`, under the migration lock of Step 3), the address, and then the setup
   code and the state `active`. The last two are **one transaction** (the plan listed them as two
   steps): a code is never shown for a shop that did not become active, and an active shop always has
   the code that was shown. A migration that fails is reported with "run the same command again"; the
   row stays `provisioning`. The shop has no address until step 4, so a half-made shop answers 404
   (an unknown address), not 503; both fail closed.
3. **Every refusal comes before the first write.** A bad or reserved name; a shop of that name that
   is not `provisioning` (a second `shop-new` for a name in use is a mistake, not a repeat; it points
   at `shop-code` and `shop-host`); a database name that is already another shop's; an address that
   another shop uses; and **a database called `shop_<slug>` that exists and that no shop owns**: the
   command will not take over a database it did not make. The slug pattern is also a CHECK
   constraint of the control database (Step 1); the reserved names are the command's own check
   (`RESERVED_SHOP_SLUGS`: `all`, `www`, `api`, `app`, `admin`, `control`), not a constraint.
   The database name is quoted as an identifier by `quoteDatabaseName`, which refuses anything but
   `[a-z0-9_]`.
4. **Running it again.** With the row in `provisioning`, the command goes on: it keeps the label and
   the database name the first run wrote, and it adds the address if it is given and not there yet.
   The state is checked again inside the last transaction, so two runs at the same time give one
   active shop, one code and one "another command changed it" refusal for the other. One advisory
   lock (`OPERATOR_LOCK`, in `control/operate.ts`) serialises every control transaction of the
   operator's commands; it replaces the lock that only adoption took. `CREATE DATABASE` and the
   migrations run outside it.
5. **The setup code.** 12 characters from Crockford's alphabet (`0-9 A-Z` without I, L, O, U: 32
   characters, 60 bits; each character is a random byte's low 5 bits, which has no bias because 256
   is a multiple of 32), shown as `ABCD-EFGH-JKMN`. Only `HMAC-SHA256(SETUP_CODE_SECRET, JSON of
["fabric-shop/setup-code", shopId, code])` is stored, as hex (a JSON list, so no shop id and code
   can be moved against each other: a test found that a plain separator allowed it). `normalizeSetupCode`
   reads what a person types (any case, spaces, hyphens; O as 0, I and L as 1). It is valid 7 days and
   for one use. A code is never written to an event, a log or the database.
6. **`SETUP_CODE_SECRET`** is a new setting: at least 32 characters, optional while the server starts
   (compose passes it empty when it is not set), required by the two commands that make a code, which
   refuse before they make anything. Step 6, which needs it to check a code, decides whether the
   server also refuses to start with `MULTI_SHOP=true` and no secret; that is where it belongs.
7. **A new code stops the one that is waiting.** `shop_setup_code.revoked_at` (control migration
   `0002_setup_code_revoked`, a nullable column; nothing is deleted). Only codes that are not used,
   not stopped and not yet run out are stopped. `shop-code` refuses a shop that has a live owner (an
   `app_user` row with `role = 'owner'` and no `voided_at`, read through a read-only session), a shop
   being made and a closed shop. Step 6 must treat a code with `revoked_at` as not valid.
8. **Addition: `shop-close`.** The plan said `closed` is final but gave no command to reach it; the
   alternative is SQL by hand in the control database. It needs `REASON` and `CONFIRM=<the slug again>`,
   works from any state, writes `shop.closed` with the reason and the state it was in, and drops
   nothing. The addresses of a closed shop stay as they are (not released), so they answer 404 and
   cannot be given to another shop. There is no command that releases an address; that is a decision
   for the owner when a closed shop's address is wanted again.
9. **Addition: `shop-host`.** Step 4 left "a second address for a shop" to this step, and a shop made
   with no `HOST` needs a way to get one. It works for active and suspended shops and refuses an
   address of another shop.
10. **Decision: no default address.** The plan left open how the address of a new shop is made from
    its slug (a slug can contain `_`, a host name cannot). None is made: the operator gives `HOST` or
    adds one later, because the domain, its DNS record and its certificate are the operator's (and
    Step 7's), and a derived name would not resolve anyway.
11. **Suspend, resume, list.** `suspend` needs a reason (up to 500 characters), works on an active
    shop and sets `suspended_at` and `suspended_reason`; `resume` clears them and keeps them in the
    event; saying a state again writes nothing (`already`). Both take effect within the 30 seconds of
    the lookup cache (assumption A5), which a test proves with a clock moved forward: 403
    `shop_suspended` on sign-in, refresh, sync and a plain route, `/health` unaffected, and the same
    the other way after a resume. `list` reads the control database and every shop's database through
    read-only sessions and writes no row. Its `schema` column is `current`, `behind` (the check the
    lookup uses, so it says what the lookup will answer), `no database` or `unreachable`; a test found
    that Drizzle wraps the driver's error, so the SQLSTATE `3D000` is read from the error's `cause`
    chain.
12. **What was not done.** The commands were not run through `docker compose exec` on a real stack
    (`make -n` shows the exact commands; the program `dist/shop.js` is what the tests call through
    `shopCommand`). `shop-new` makes no DNS record and no certificate (Step 7). A shop made here has a
    code but cannot use it yet: the sign-up with a code is Step 6. Dropping a database stays a
    manual decision and no command is built for it.

### 2026-11-13: Step 6, registration with a setup code, was built

Section 6 (the setup code) and the sign-up it opens are built as written, with these details made
exact and four decisions that the plan left open (items 2, 5, 6 and 9).

1. **Where it lives.** A `SetupCodes` service in the `registration` module, built only when the server
   serves many shops (`RegistrationModule.forRoot(config)`; with the flag off the module is what it
   was, and `/auth/register` takes no code). `RegistrationService` keeps its work (`registerOwner`:
   the owner, the audit entry and the four settings, unchanged) and gains the two calls around it:
   `check` before, `use` after. It refuses to be built with `MULTI_SHOP=true` and no codes service,
   so there is no path to a sign-up without the check.
2. **Decision: the server does not start with `MULTI_SHOP=true` and no `SETUP_CODE_SECRET`.** Step 5
   left this open. A sign-up that cannot check a code must not open, and an API that starts and then
   answers every sign-up as closed would hide the fault until an owner tried. `SetupCodes` calls
   `requireSetupCodeSecret` in its constructor, so the start-up fails with "SETUP_CODE_SECRET is not
   set" and the compose stack does not become healthy. `make shop-adopt` and the shop commands still
   run with `MULTI_SHOP` off; the secret stays optional for a one-shop server. A test builds the
   server without it and expects that error.
3. **`GET /auth/registration`** returns `{ open, shopId, setupCodeRequired: true }` while the shop of
   the address waits for its owner, and omits `setupCodeRequired` otherwise (a literal `true` in the
   contract, never `false`), so a one-shop server answers exactly as before. "Waits for its owner" is
   derived, never stored: the sign-up is open (no live owner, `OWNER_SIGNUP_ENABLED`) on a shop that
   the host step served, which only an `active` shop is (a suspended one is refused with 403 before
   any route runs, a shop being made answers 503, a closed or unknown address 404).
4. **`POST /auth/register`: check, register, mark used.** `check` reads what was typed with
   `normalizeSetupCode`, finds the newest code of this shop that is not used, not stopped and not run
   out (the `shop` row must still be `active`, read in the same query, so a suspension inside the 30
   seconds of the lookup cache still closes it), and compares `hashSetupCode(secret, shopId, code)`
   with the stored hash in constant time. Then `RegistrationService` runs unchanged. Then `use` marks
   the code used with one conditional `UPDATE ... WHERE id = $1 AND used_at IS NULL AND revoked_at IS
NULL AND expires_at > now() RETURNING` and writes `shop.setup_code_used` (actor `api`, the code's
   id, never the code), in a transaction of the control database. If `use` finds nothing to update it
   throws and the request fails with the shop transaction. It fails closed. Two sign-ups with the
   same code at the same moment are serialised twice over: the advisory write lock of the request
   transaction, and the partial unique index `app_user_single_owner`; one makes the owner, the other
   gets the answer of a closed sign-up. Normative: `check` never writes a use, and `use` is the only
   place a code becomes used.
5. **Decision: one answer for everything that does not open the sign-up.** A wrong code, one in the
   wrong shape, a missing one, an old one, a used one, a stopped one, the code of another shop, a
   shop with no code waiting, and `OWNER_SIGNUP_ENABLED=false` all get `signUpClosed()`: the same
   403 and the same body as a closed sign-up (the function is exported from the `auth` module and
   used by both). A stranger learns nothing about a code and nothing about whether a shop waits for
   its owner. The one other answer is the 429 `too_many_requests` of the address limit (item 6),
   which says nothing about any code.
6. **Decision: two limits, with these numbers.** _For each shop:_ the code that is waiting takes
   `SETUP_CODE_MAX_FAILED_TRIES = 10` wrong tries; the tenth sets `revoked_at` and writes
   `shop.setup_code_locked`. It is a lock, not a cool-down: the operator makes a new code (which
   also resets the count, because it is a new row), and nobody can wait a lock out. The count
   (`shop_setup_code.failed_tries`, which Step 1 made for this) is incremented in its own control-
   database transaction, so it survives the rollback of the refused request and a restart. A try
   with no code waiting, or a shape no code has, is not counted against a code (there is none).
   10 tries on 60 bits are a 1 in 10^17 chance of a guess. _For each client address:_ 5 failed
   tries of any kind in a fixed 15 minute window (`SETUP_CODE_ADDRESS_MAX_FAILED`,
   `SETUP_CODE_ADDRESS_WINDOW_MS`) block the address for the rest of the window with 429, even for
   the right code. They are counted in memory (`FailedTries`, at most 10 000 addresses, the old
   windows and then the oldest dropped first), so a restart clears them; it limits guessing and is
   not a record. The address is `@Ip()` behind `trust proxy` (the real client behind Caddy). It is
   below the shop limit on purpose, so one address alone cannot use up a code in one window.
7. **What this does not stop.** One address can still spend a code in two windows (5 + 5 tries in
   30 minutes), which locks the shop's code until the operator makes a new one. That is a nuisance
   at onboarding, not an attack on a shop's data, because no code means no owner can be made and a
   shop that has an owner takes no code. Many owners behind one address (an office, a mobile
   network) can block one another for 15 minutes. Both are cheaper than a shared counter that
   outlives a restart; the owner may want that later.
8. **Edge: the code is marked used before the shop transaction commits.** `use` runs inside the
   request, after the owner and the settings are written, and commits in the control database first.
   If the shop's own commit then fails (a lost connection at the last moment), the code is used and
   no owner exists. The shop then waits for its owner with no code, and `make shop-code` makes a
   new one. The other order (mark after the commit) was rejected: a failure there would leave an
   owner and a code that still works, and the one-use rule would depend on the order of two commits.
9. **Decision: web.** The first sign-up step shows the code field, first in the step, only while the
   status says `setupCodeRequired`. It reads the shape with the same `normalizeSetupCode` as the
   server (it is in `@fabric/contracts` for that, with `SETUP_CODE_ALPHABET`, `SETUP_CODE_LENGTH`
   and `formatSetupCode`; `hashSetupCode` and the generator stay in the API because they need Node's
   crypto). When the server refuses with the closed answer, the page does not leave the form: it
   asks `registrationOpen()` again, and only if the shop is closed now does it go to the closed
   page; otherwise it goes back to the code field with "This code did not work", keeps everything
   typed, and does not send the same refused code twice. The code is not shown on the review step.
   The `too_many_requests` text no longer says "a minute", because the address block is 15 minutes.
   The notice screen for a suspended shop is still not built.
10. **Test harness.** `createTestApp` in adopted mode (`TEST_SHOPS=adopted`) has the owner-less
    sign-up specs of earlier steps pass unchanged: it makes a setup code for the adopted shop with
    `issueShopCode` and adds `setupCode` to every `/auth/register` body that has none. That is the
    only place the harness differs from a real client. One spec of Step 4 that asserted the exact
    status of an ownerless adopted shop now expects `setupCodeRequired: true`; that is the step's
    intended change, and the same case is tested for each state in the new spec.
11. **Browser test.** `apps/web/e2e/signup-new-shop.spec.ts` runs the whole wizard on a shop made by
    `shop.js new` (two shops, `signup-en.localhost` and `signup-ar.localhost`, one for each
    language), only with `E2E_SHOPS=adopted` (`pnpm --filter @fabric/web test:e2e:adopted`), because it
    needs a multi-shop server. `global-setup.ts` gives the API a `SETUP_CODE_SECRET`, makes the two
    shops before it restarts with the flag and reads each code from the command's output into an
    environment variable. Each run types a code of the wrong shape, then a well-formed wrong one (the
    wizard returns to the code, keeps the name, and does not send it twice), then the right code
    typed as a person would (lower case, spaces), and ends signed in with the shop's name shown.

### 2026-11-13: Step 7, HTTPS for many addresses, was built

Assumption A2 is now tested, with `caddy:2.11.7-alpine` in Docker and the real API (see 6). One
decision of "The `ask` address" changes: the catch-all site is a wildcard site (see 2).

1. **The route.** `GET /internal/known-host?domain=<name>` (`KnownHostController` and
   `ShopsService.hasOpenShopAt`, in `modules/shops`, so it exists only with `MULTI_SHOP=true`; on a
   one-shop server it is a 404 and no name gets a certificate). It is `@Public()` and left out of
   the OpenAPI document. It is outside the host rule: `ShopsModule` excludes `GET
internal/known-host` from `ShopHostMiddleware`, as it does `/health`, because Caddy calls it with
   the host `api:4000`, which no shop owns. It opens no shop and reads the control database only. It
   answers 200 with an empty body when `domain` is the address of a shop in the state `active`,
   `suspended` or `provisioning` that has not been released, and 404 for everything else: an unknown
   name, an address of a closed shop, a released address, a name of a bad shape, and **every IP
   address** (`net.isIP`, so it holds for IPv6 and for an IP that is a shop's own address). The
   check for `X-Forwarded-For` comes first, so a proxied request gets the same 404 whatever the
   name is. Every refusal has the same body (only the request id differs). A missing, empty or
   too long (over 253) `domain` is 400, as everywhere in the API. The name is lower-cased first.
2. **Decision: a wildcard site, not a catch-all.** The plan said a catch-all site (`https://`).
   Running it showed that it breaks the bare-IP shop. A browser that opens an IP address sends no
   server name; Caddy then uses `default_sni` (the IP). Certmagic (the library under Caddy) does the
   permission check for that name _before_ it falls back to the default certificate, and a site with
   no name puts on-demand on the policy that takes every visit without a server name. So Caddy asked
   the API about `127.0.0.1`, the API said no (as the plan wants), and the handshake failed with
   `tlsv1 alert internal error`: shop 1's address would stop opening. The original Caddyfile opens
   it in the same harness. Two ways out were tried on paper and one in the harness. Approving the IP
   in the `ask` route makes Caddy look for the certificate under the issuers of the on-demand policy
   (Let's Encrypt), not under `local`, where the IP's certificate is, and go to Let's Encrypt for an
   IP: rejected. A wildcard site `*.{$PLATFORM_DOMAIN}` with `tls { on_demand }` takes only names
   under that domain, so a visit with no server name still goes to the old policy: the IP opens, a
   shop name gets its certificate, a random name under the domain is refused by the `ask` route, and
   a name outside the domain is not asked about at all. Caddy asks for no wildcard certificate (none
   was obtained). **What is lost:** a shop at an address that is not directly under `PLATFORM_DOMAIN`
   (its own domain, or a name two labels deep) gets no certificate. It needs its own site address in
   the Caddyfile. That is not built; nothing in the plan needs it, and the owner can ask for it.
3. **`PLATFORM_DOMAIN` has two jobs.** It is the domain of that site (compose gives the `proxy`
   service `platform.invalid` when it is not set, a name that never resolves, so a one-shop server
   gets no certificate and is the server it was), and `make shop-new SLUG=aziz` uses
   `aziz.<PLATFORM_DOMAIN>` as the address when `HOST=` is not given (an underscore in the slug
   becomes a hyphen, because a host name has none; `HOST=` still wins; with no `PLATFORM_DOMAIN` the
   shop has no address yet, as before). The Makefile reads it from `.env` the way it reads `STACK`.
4. **The two layers.** The site block answers 404 for `/api/internal/*`, and the route refuses any
   `X-Forwarded-For`. Each holds alone, shown on the stack (6): with the API check taken away and
   the Caddy block in place the public path gets 404; with the Caddy block taken away and the API
   check in place it gets the API's 404 (Caddy added `X-Forwarded-For`); with both taken away it
   answers 200 and tells the name is a shop. Eight spellings of the public path through Caddy all
   got 404 (`/API/…`, `/api//internal/…`, `/api/./internal/…`, `/api/%69nternal/…`,
   `/api/internal%2F…`, a trailing slash, `/api/x/../internal/…`, and a forged `X-Forwarded-For`
   in the request), and without the Caddy block they got the API's 404 or no route. The API port
   is not published in `compose.prod.yml` (a comment there says it must never be), and the deploy
   runbook has the rule and the three checks.
5. **No cache for the `ask` route.** Caddy asks only for a name that has no certificate, and a shop
   made a second ago must get one at once; `ShopLookup` would have kept an answer "unknown" for 30
   seconds. The cost is one indexed read of the control database for each such handshake, and a
   name that does not look like a host name is refused before the read. Caddy has no rate limit of
   its own here (its `interval` and `burst` options are not advised), so a flood of random names
   under the domain makes that many reads, and no request to Let's Encrypt, because they are
   refused. Only a name that is a shop can use the Let's Encrypt limits.
6. **What was run (A2).** Caddy 2.11.7 in Docker, `local_certs` added to the global block (the only
   difference from `infra/docker/caddy/Caddyfile`), the real API built from this tree against
   PostgreSQL 16 in a container with `MULTI_SHOP=true`, a static page for the web service. Caddy's
   `ask` call is a `GET` with `?domain=<name>`, the host `api:4000` and no `X-Forwarded-For`; any
   2xx lets it go on, and any other answer ends the handshake with a TLS alert. A request that came
   through Caddy had `X-Forwarded-For` and `X-Forwarded-Host`. The bare IP (`127.0.0.1`) opened. A
   name that was not a shop had no certificate. `shop.js new` made a shop and the next request to
   its address got a certificate from Caddy's own authority and the page, with no change to the
   Caddyfile and no restart. A suspended shop's address got a certificate and the API answered 403
   `shop_suspended`; a closed shop's address got none. Plain HTTP to the shop's name was
   redirected to HTTPS (308). Caddy logs nothing at its default level for a refused name; the 404
   is in the API's log. Not run: Let's Encrypt itself, its limits (50 certificates for each
   registered domain each week, 5 failed validations for each name each hour, 5 identical
   certificates each week, all as published), a real DNS wildcard and a real server. That is Step 10.
7. **Tests.** `test/known-host.e2e-spec.ts` (27): the names that get 200 (active, suspended, being
   made, other case, no sign-in, the host `api:4000`), the names that get 404 (a table of nine: nobody's,
   closed, released, with a port, with a bad character, with a space, with a leading or a trailing
   dot, the bare name `api`; then IPv4, IPv6 and an IP that is a shop's own address), the same
   answer for each refusal, 400 for a missing, empty or long name, a proxied request refused (also
   with an empty header, several addresses, other letter cases and the shop's own host), a shop made
   a moment ago and a shop closed a moment ago both at once, nothing written, and a one-shop server
   with no route. Taking things away fails them: dropping the `X-Forwarded-For` check fails 5,
   allowing closed shops 3, allowing IPs 2, not excluding the route from the host rule 9, no
   lower-casing 1, refusing suspended shops 1.
8. **Not done.** A certificate for an address outside `PLATFORM_DOMAIN`. A rate limit on the `ask`
   route. A check of the Caddyfile in CI (`caddy validate` works on it with `DOMAIN`, `ACME_EMAIL` and
   `PLATFORM_DOMAIN` set). The real certificate check, Step 10. For Step 8 (backups) nothing changes
   here; `ShopLookup` still has its own copy of the host pattern, which can use
   `controlSchema.SHOP_HOST_PATTERN` when that file is touched next.

### 2026-11-13: Step 8, operations for each shop, was built

Decision 8 ("Backups and restore") is built as written, with the additions below. The command-line
tools now work on one shop at a time, the backups are one folder for each shop and one for the
control database, and A3, A4 and A6 are measured.

1. **The commands name the shop.** `make owner`, `partner-user`, `cashier-user`, `export` and
   `import` take `SHOP=<slug>` (`apps/api/src/shop-scope.ts`: `checkShopArgument`, `inShop`,
   `exitCodeOf`). The work runs inside `ShopsService.runAsShop(slug, …)`, the same binding a request
   gets, so `TransactionHost.db` is that shop's database and no other. On a many-shop server a
   missing `SHOP` stops with exit code 2 before the password or the file is read from stdin; an
   unknown or closed shop stops with exit code 1 (`There is no open shop "<slug>"`); on a one-shop
   server `SHOP` is refused with exit code 2, so a command typed for the other kind of server never
   runs by mistake. The commands run no migrations (only the API start does). `make export` writes
   `backups/<slug>/export_<UTC time>.json` with `SHOP`, and `backups/export_<UTC time>.json` without.
2. **Backups.** `infra/scripts/backup.sh` and the `backup` service (`nightly.sh`) read the shops from
   the control database and dump each one that is not closed to `<root>/<slug>/<database>_<UTC
time>.dump`, suspended shops included, then the control database to `<root>/control/`. A shop
   still being made that has no database yet is skipped without a failure. One shop that cannot be
   dumped does not stop the others: the run goes on, dumps the control database whatever happened
   before, and ends as a failure. When the list of shops cannot be read, no shop is dumped, the
   control database is tried, and the run fails. `SHOP=<slug>|control|all` picks what `backup.sh`
   dumps. **Rotation works on one folder at a time and removes only a file named exactly
   `<database>_<YYYYMMDD>T<HHMMSS>Z.dump`**, sorted by name (the name holds the time, so a copied
   folder does not break the order, which the file times would). A folder of another shop, a file
   put there by hand, and the dump of a database whose name begins with this one's
   (`shop_alpha_two_…` next to `shop_alpha`) are never matched. The plan's worry about `shop` and
   `shop_two` is a test.
3. **Two things the proof found.** (a) `docker compose exec` reads the standard input, so a `while
read` loop over the list of shops stopped after the first shop and dumped only one. The loops in
   `backup.sh` and `verify-backup.sh` read the list from file descriptor 3. (b) A dump made with a
   `pg_dump` newer than the server (the host's 18 against the stack's 16) cannot be read by the
   server's `pg_restore` (`unsupported version (1.16)`). The scripts use the tools inside the
   Postgres container, so this cannot happen through them. `nightly.sh` has a `BACKUP_ROOT` setting
   (default `/backups`, the container's mount) only so that its test can write to a temporary folder.
4. **Restore.** `make restore SHOP=<slug>|control FILE=…` replaces that database and nothing else.
   It reads the database name that the dump holds (`; dbname:` in `pg_restore --list`) and refuses a
   dump of another database, so another shop's file cannot go into this shop (`FORCE_DB_MISMATCH=1`
   is for moving a shop whose database has another name). It asks for the shop's name (`CONFIRM=`),
   refuses a closed or unknown shop (a closed shop's dump goes to a scratch database), and refuses
   `SHOP` together with a scratch database. It stops `api` and `web` and starts them again at the end
   also when the restore fails (a `trap`), restores in one transaction, and gives the shop a new
   `server_instance` row. **It writes `shop.restored` to `shop_event`** (actor: the login of the
   person, detail: the file and the database), in the control database, because the shop's own
   `audit_log` is what the restore replaced. A restore of the control database writes no event, for
   the same reason. The first version still takes every shop offline for the time of the restore, as
   decision 8 says; restoring one shop while the API runs is not built.
5. **Verifying.** `make backup-verify` makes one backup, then restores the newest dump of each shop
   and of the control database into `<database>_restore_check` (the name must fit the 63 characters
   of a database name), compares the row count of every table and drops the scratch copy. It prints
   one line for each database and exits 1 if any differs; `KEEP_SCRATCH=1` keeps them.
6. **A4, measured.** The real API (`node dist/main.js`, `NODE_ENV=production`) against PostgreSQL 16
   with default settings (`max_connections` 100) on a 12-core developer machine, with 3, 10 and 30
   shops, each request a login with a wrong password (it opens the shop's database and answers 401).
   _Memory is not the limit_: the process is about 300 MB at start and grew by 3 MB for 3 and for
   10 shops and by 3 to 20 MB for 30 (the larger figure was with 20 requests at once on each shop),
   less than 1 MB for each shop that was touched. _Connections
   are_: each shop's pool opens up to `SHOP_POOL_MAX` (5) connections, and the peak was shops times
   that when each shop had that many requests at once: 15 for 3 shops, 50 for 10 shops. With 30 shops
   and 20 requests at once on each, the peak reached 100 and 249 of 600 requests failed with HTTP 500
   (the log says `sorry, too many clients already`: the answer is a 500, not a 503). With 3 requests
   at once on each of the 30 shops the peak was 90 and none failed; with 5 at once, 54 of 150 failed.
   Idle pools hold nothing: 12 to 15 seconds after the load every shop had 0 connections (the pool
   closes an idle connection after 10 seconds), so only shops in use take a slot. A shop's real load
   is one owner, a partner and a tablet or two, which is 2 or 3 requests at once at the most. So
   about 30 shops fit with the default `max_connections`, with no room to spare; for more, raise
   `max_connections` (the API runbook says how many to leave) or lower `SHOP_POOL_MAX`. Not measured:
   a real server (2 vCPU) and real traffic (Step 10), the CPU of the API (the latency was 300 to 750
   ms at the median with 600 requests at once, mostly the password check), `max_connections` above 100.
   Not changed: the API does not turn "too many clients" into a 503.
7. **A6, measured.** The same machine. `nightly.sh` with 30 shops (the migrated schema, no data) and
   the control database: 5.3 seconds in all, 0.17 seconds for each database, 328 KB for each shop's
   dump. One shop with 500,000 audit rows (382 MB; hexadecimal text, which compresses badly): 7.5
   seconds to dump with `--compress=9` into 119 MB, 5.9 seconds with `--compress=6` into the same
   size, 5.4 seconds to restore with `restore.sh`, and the row count came back equal. About 50 MB of
   database for each second. So a night with 30 shops of 100 MB each is about a minute here, and 30
   shops of 400 MB each about 4 minutes; a 2-vCPU server will be slower by some factor that was not
   measured. The disk is what to watch: the dumps of every shop, times `BACKUP_KEEP`. Not measured:
   a real shop's size (the shops are new), the owner's server, a dump while the shops are busy.
8. **A correction to decision 8.** It says rotating `JWT_ACCESS_SECRET` signs out every shop. It stops
   the **access tokens** of every shop at once (a shop's key comes from the secret and the shop's id),
   and each device gets a new one with its refresh cookie, because refresh tokens are random values
   in the shop's database and do not depend on the secret. Nobody signs in again, but all the shops
   refresh together. The runbooks say so.
9. **What was run.** On a scratch stack (Docker Compose, PostgreSQL 16.15, the repo's own scripts, a
   shop adopted from a one-shop database, two active shops, a suspended one, a closed one, one being
   made): the one-shop server unchanged (flat dumps, rotation, `SHOP` refused, verify OK on 41
   tables); the multi-shop layout, rotation by folder, a decoy file that survives, `SHOP=alpha
BACKUP_KEEP=1` that leaves the other shop's folder identical (same files, same sizes); the real `nightly.sh`
   in `postgres:16.15-alpine` (busybox `sh`), with one shop's database missing (the others and the
   control database are dumped, exit 1) and with the control database unreadable (exit 1); the
   restore of yesterday's dump of shop A: its customers went from 9 back to 5 and it got a second
   epoch, and the fingerprints of the main shop, shop B and shop C (customers, epochs, audit rows)
   were the same before and after; `shop.restored` in the control database; `api` and `web`
   started again (their start times changed); the refusals (another shop's dump, a closed shop, no
   `SHOP`, `SHOP` with a scratch database, a wrong confirmation) all change nothing;
   `FORCE_DB_MISMATCH=1`; the restore of the control database; `backup-verify` of all and of one
   shop, no scratch database left. The node commands were also run as processes from the built
   `dist` (exit codes 0, 1 and 2, the shop that got the account, an import refused for a shop that
   has data). Not run: a real server, an off-site copy, the lost-server rebuild, the move of a shop
   between two servers.
10. **Tests.** `src/shop-scope.spec.ts` (7, unit): the rules for `SHOP` in both modes and the exit
    codes. `test/shop-scope.e2e-spec.ts` (4): a cashier is made in the named shop only; a password
    reset signs out that shop and no other; no shop, an unknown shop and a closed shop are refused
    with nothing written; an export of one shop differs from another's, an import into a shop that
    has data is refused, and an import into an empty shop leaves the others as they were. Binding
    `shop_b` whatever is named fails all 4. `test/nightly-backup.e2e-spec.ts` (7, with the host's
    `pg_dump`, `pg_restore` and `psql`, skipped without them): one dump for each shop that is not
    closed and one for control, each of its own database; rotation by folder with a decoy and a
    stranger file, a closed shop's folder untouched; no `.partial` left; `BACKUP_KEEP` refused when
    it is not a positive whole number; the one-shop layout removes only its own database's files; a
    failed shop does not stop the others; the list of shops unreadable. Matching `<database>_*.dump`
    in the rotation fails 1, dumping closed shops fails 2, stopping at the first failed shop fails
    1. The shell scripts have no unit tests of their own; the run above is their check.
11. **Not done.** Restoring one shop while the API runs. A lost-server rebuild and a move of a shop
    between two servers, written in the runbooks from commands that were each run, are not
    rehearsed (Step 10). A 503 for "too many clients". A check of the scripts with `shellcheck` in
    CI (it is not installed here; the scripts keep its directives). The `CLAUDE.md` commands table,
    which is Step 9's.

### 2026-11-13: Step 9, proof across shops, was built

The ADR says (decision 1, and the safety argument in the plan) that no query can span two shops
because no connection does, and that the isolation is structural, not enforced by the database. Step 9
is the proof that it holds as built, in two places: the API with two shops in one process, and the
browser with a shop that signs up on a running server. Nothing in the server changed in this step.

1. **API: `apps/api/test/cross-shop.e2e-spec.ts` (13 tests).** Two shops (`a.cross.test`,
   `b.cross.test`) in one API process, each with its own owner and its own database. In each shop
   the test writes a customer, a supplier, a product, a purchase (50 m for 800 dh, 300 dh paid to the
   supplier), a sale (1.5 m at 18 dh, 10 dh paid, the rest on credit, built with
   `buildSaleAggregate` and pushed as a `sale` op like a device), an expense and the `shop_name`
   setting. Then:
   - a pull from the start of each shop has none of the other's ids and none of its names;
   - every `GET` route of the OpenAPI document (46 of them) is called in both shops, with the path
     parameters taken from the records of the shop being asked, and the answers hold nothing of the
     other shop. The list is read from `/docs/json`, so a new route is covered without touching the
     test; a route with a path parameter other than `id` or `key`, or a required query parameter that
     the test does not know, makes the test fail, so a new kind of route cannot be skipped by
     accident. A positive control (19 routes that must show the shop's own data) keeps "empty
     because nothing was found" from passing as "isolated";
   - the databases themselves, by SQL: each holds its own rows and none of the other's, one owner
     each, and the audit log names only its own ids;
   - writes that name the other shop's records: shop A's sale and its void pushed to shop B are
     refused; the same customer id written in B makes a separate record in B (checked by the API and
     by SQL); a token of one shop is refused with 401 at the other's address (read of `/customers`,
     both ways), and no route without a path parameter shows anything of the other shop when it is
     called with the wrong shop's token (a public route may answer; none shows the other's records).
     A write with the wrong shop's token is not tried: the guard refuses the token before any
     route runs, so a write is no different from a read there.
2. **Browser: `apps/web/e2e/second-shop.spec.ts` (1 test).** The shop at `shop2.localhost` is made
   by `e2e/global-setup.ts` as `make shop-new` makes it, before the flag is turned on, with its own
   database. The spec checks that the sign-up page asks for the setup code, runs the wizard in
   Arabic, adds a product, switches the Wi-Fi off, makes a sale, switches it on and waits for the
   sale on the server (a total of 3,000 cents: 1.5 m at 400 rial), signs in on a phone-sized second
   device and sees the product, and then checks the shared shop: its pull from the start is the same
   as before the spec, it holds none of the second shop's records, the owners' logins are refused at
   each other's address, and the second shop's token is refused at the shared shop. It uses its own
   database, so no other spec can be disturbed by it and it cannot be disturbed by them.
3. **Where the browser run is.** It stays the adopted mode that Step 4 made (`E2E_SHOPS=adopted`,
   the shop adopted as shop 1, the API restarted with `MULTI_SHOP=true`), not the default of `make
e2e`. `make e2e` is unchanged and still runs the one-shop server, because that is the server
   that is live until the owner turns the flag on. The adopted run is `make e2e-shops` and a step in
   CI ("End-to-end (Playwright) as an adopted shop"). The plan puts shop 1 on `localhost`; it is on
   `127.0.0.1`, which is the address every spec already uses for the API and the web server and the
   one Step 4 adopted. The second shop is on `shop2.localhost`, which Chromium resolves to the
   loopback without any setting.
4. **Support code.** `MultiShopApp.shop(host)` (`test/support/multi-shop-app.ts`) gives `http()` of
   one shop: a fresh agent that sends the shop's address on every request and keeps no cookie, so
   the shops cannot share a session by accident. `stockKit` takes `Pick<TestApp, 'http'>` instead
   of a whole `TestApp`, so it can be used with it. No existing spec changed.
5. **What the proof was shown to catch.** With `ShopPools` returning one pool for every shop, the
   spec fails at its set-up (the second shop's owner cannot sign in: the pool holds the first
   shop's database). That mistake would put one shop's money in another's, and it is the one the
   plan names. **A `shop` claim check removed from the token guard fails nothing**: the key of each
   shop already refuses another shop's token with 401 before the claim is read, so the check is a
   second lock behind the first, and the proof cannot tell it is there. It stays, as defence in
   depth.
6. **A finding about the browser spec.** It first asserted that the shared shop had records before
   the spec started, so that "unchanged" would mean something. The shared shop is empty when the
   spec is run alone, so the assertion failed. It is removed: the comparison before and after holds
   in both cases, and the shop with records is the API spec's job (decision 1 above). In a whole run
   the shared shop is full.
7. **Not covered.** Only `GET` routes are swept (a write is reached by the sync tests and the
   write tests above, not by every route); a route for which no record was written returns nothing
   in both shops and so shows nothing about isolation; the web app's own Dexie database is per
   browser origin, and the second origin was not asked to open the first's; the real DNS, the
   certificate and the proxy of the owner's server are Step 10.

### 2026-11-13: Step 10, the roll-out, was rehearsed

Step 10 is the run on the owner's server, with its DNS, its certificates and its people. None of
that can be reached from the repository, so this step rehearsed every stage that does not need it,
on a copy of the production stack, and wrote the result as a runbook
(`docs/runbooks/multi-shop-rollout.md`). No code changed. The live run is the owner's.

1. **What was run.** The production compose file (`compose.prod.yml`: PostgreSQL, API, web, Caddy,
   backup) in two scratch copies: the previous release (`b62baa6`) and this tree, one Docker
   project, Caddy's own certificate authority, the loopback for DNS. In order: the old release with
   real data; this release with `MULTI_SHOP=false`; a dump and `make backup-verify`; `make shop-adopt` in the running container; one edit of `.env` (`MULTI_SHOP`, `SETUP_CODE_SECRET`,
   `PLATFORM_DOMAIN`) and one `make up`; `make shop-new`, a first visit to its address (the
   certificate is made then), sign-up with the code, `shop-suspend` and `shop-resume`; a name that is
   not a shop; the backup service for both shops and `control/`; each rollback and a roll forward.
   Each stage passed, or gave a finding in point 3 to 6.
2. **Measured.** Turning the flag on takes one restart: `make up` took about 20 seconds, and the API
   answered with an error or not at all for about 17 seconds of them (a poll every 0.3 seconds). The
   shop's migrations in this release are byte for byte those of the previous one, so the shop's
   database is not touched until a later release changes its schema. The roll back was not timed.
3. **Correction: a token made with the flag on is refused with the flag off.** This ADR said that
   with the flag off such a token is "ignored", so nobody is signed out. That is wrong. The access
   token carries a `shop` claim and is signed with the key of that shop (derived from
   `JWT_ACCESS_SECRET` and the shop id, Step 2 amendment, 1); a server with the flag off checks it with the
   one-shop key, so it fails the signature and the request gets 401. The device then refreshes once
   with its refresh cookie (which has no `Domain` and does not change) and gets a token made the
   one-shop way. The same happens the other way round, when the flag goes on: the token made without
   a shop gets one 401 and the refresh gives one with the `shop` claim. Both directions were run with
   `curl` (old token, 401; refresh with the old cookie, 200 and the shop claim, the same records). So
   nobody types a password in either direction, but each device does have one 401 and one refresh,
   and a device whose refresh cookie is gone has to sign in. The two places in this ADR that said
   "ignored" and the rollback bullet in the plan are corrected. A real browser session held open
   across the restart was not run; the client's code that does this was read (`session.ts`).
4. **Finding: roll back with neighbours in the right order.** With the flag off the server does not
   read the address, so a neighbour's address that still reaches it, and already has a
   certificate, opens shop 1's pages. Rolling back with neighbours therefore starts at the proxy:
   empty `PLATFORM_DOMAIN`, `make up`, check that a neighbour's name fails with a TLS error (it did),
   and only then `MULTI_SHOP=false`. The plan said "close their addresses at the edge first"; the
   runbook says how, and that the check is the same one as stage 4.
5. **Finding: the order of adopt and flag.** `make shop-adopt` works with the flag still off, so it
   is run first, in the running container, and `make shop-list` is read (shop `active`, the address
   the devices use, schema `current`, owner `yes`). With the flag on before the adopt, or with the
   wrong address, the live address answers 404 `No shop is served at this address`; the way out is
   the flag off, or `make shop-host`. The runbook makes this a check before the restart.
6. **Finding: dumps made before the flag stay in `backups/` and are not rotated.** With the flag
   on, the backup service writes `backups/<slug>/` and `backups/control/` and rotates inside each.
   The flat dumps from before are never touched again. The runbook keeps the last one as the way
   back for the first week and says to delete them by hand after that. It is not automated: a
   script that deletes dumps is a dump that may be missing the day it is needed (a decision for the
   owner, in the plan).
7. **Not run, and only the owner can.** The wildcard DNS record on the real domain; a real
   certificate from Let's Encrypt and its limits (50 a week for each registered domain, 5 failed
   validations an hour for each name); a phone over real HTTPS and the installed app on the
   neighbours' devices; a browser session across the restart; the real timings (a restart's length
   depends on the size of the migrations to run, which are none here). `docs/MVP_ACCEPTANCE.md`,
   "A server with many shops", is the by-hand list for the first neighbour.
8. **The plan is finished as far as the repository goes.** The steps after this are in the plan's
   "Later" list and each needs its own decision.
