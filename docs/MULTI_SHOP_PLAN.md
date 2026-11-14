# Multi-shop plan: many shops on one server

Status: accepted. The design is [ADR 0029](adr/0029-multi-shop-database-isolation.md), which the owner approved on 2026-11-12. This plan was first proposed on the same day, then rewritten after the ADR review, so it now follows the ADR. If the plan and the ADR disagree, the ADR wins and the plan has a bug. Steps 0 to 10 are done, and Step 10 is done as far as a repository can do it: the roll-out was rehearsed and written as a runbook, and the run on the live server is the owner's. The owner asks for each next step by name ("do step 2"), and nothing is built before that.

## Goal

One server, one app, many shops. Each shop has its own address (for example `ghait.yourdomain.com`), its own owner, its own staff and its own data. A new shop is made on the server in about a minute, with no new install. One shop can never see another shop's data.

## The decision

Give each shop its own Postgres database. Add one small control database that lists the shops. Do **not** add a `shop_id` column to every table.

Why:

- Safety. With `shop_id`, about 40 tables and every query need the filter. One missed filter shows one shop's money to another shop. With one database per shop, no query can span two shops and no query can forget a filter. This isolation is structural: the API holds the login for every shop database, so the database itself does not enforce it. The answer is a binding that is made once for each request and cannot nest, and a test that signs in to two shops (Step 9).
- The rules we already built stay true without edits. The `app_user_single_owner` index (one owner) is right for each shop. The write lock and the `server_seq` order (ADR 0002) stay per shop, because advisory locks and sequences belong to one database. `packages/core`, the sync protocol, the Dexie schema and the repository files do not change.
- Backups. One shop is one dump and one restore. With shared tables you cannot restore one shop without touching the others.
- The live shop becomes shop 1 without moving a row. No migration runs on its database.
- Later, a big shop can move to its own server: dump its database and restore it there.

Costs:

- One small connection pool per shop (5 connections, made on first use, and an idle pool holds none).
- All shops run the same app version. One deploy updates every shop.
- No reports across shops. Nobody needs them.
- Making a shop needs the right to create databases. The API already connects as the Postgres superuser in the Docker stack.
- One API process serves every shop, so a crash or a deploy reaches all of them. Offline tablets keep selling, which makes this less harmful.

Where the change goes: `TransactionHost` (`apps/api/src/database/transaction.ts`) is the only class that holds the database. It will read the pool of the current shop from a binding that is made once for each request. The step that finds the shop lives in `apps/api/src/modules/shops` and is registered in `app.module.ts`. It cannot live in `RequestContextMiddleware`, because that file is in `common`, and `common` never imports modules.

## How a request finds its shop

```text
tablet -> https://ghait.yourdomain.com/api/... -> Caddy -> API
API: address "ghait.yourdomain.com" -> control database -> shop "ghait" -> database shop_ghait -> the code we have today
```

The address decides the shop. Each shop's app lives on its own address, so on every device it also gets its own local database, cookies and service worker. The refresh cookie has no `Domain` attribute (`refresh-cookie.ts`), so each address keeps its own. The sign-in page needs no shop field.

- The API reads `req.hostname` (Express takes `X-Forwarded-Host` from trusted proxies; `trust proxy` is already set in `common/http.ts`), puts it in lower case, and compares it exactly with `shop_host`. There is no wildcard or suffix matching.
- Unknown address: 404 with a fixed body. Suspended shop: 403 with the code `shop_suspended`. A shop that is being made, or whose migration failed: 503.
- `/health` is outside this rule. It stays public liveness with no database work, because Docker calls it with the host `127.0.0.1`, which is no shop's address. The state of each shop comes from `make shop-list`.
- The API keeps the answer of each lookup for 30 seconds. If the control database cannot be reached, it serves from the last answer. A host name it has never seen fails closed with 503.
- The token carries the shop id. A token from one shop is refused on another shop's address with 401, before any user is read.
- Outside a request (the `make` scripts), the code must name the shop. It never falls back to a default shop.

## What does not change

- `packages/core` and every accounting rule.
- The sync protocol, `SYNC_ENTITIES`, the Dexie schema and the outbox.
- Roles, the audit log, period locks, zakat and partners.
- The tables and migrations of a shop's database. This plan adds none.

## Rules while building

- The live shop is not touched before Step 10. `MULTI_SHOP=false` keeps today's behaviour, so a deploy of this code is safe until the flag is turned on. It is the only switch in the plan, and it exists so the live shop can be rolled out and rolled back. The one visible difference with the flag off is from Step 1: an error on an idle database connection is now logged and the connection is dropped, where before it stopped the process.
- Build one step at a time. Each step has its own tests, ends with `make check` (the known red baseline excepted) and its "Done when", and then stops with a report.
- Every new text goes into both `ar.ts` and `en.ts`. Web features go through `local-db` repositories (CLAUDE.md).
- Do not build the API on the host while the dev stack is up: it empties `apps/api/dist` and the dev API stops. e2e specs share one database, so a spec that needs its own data makes its own shop.
- No hard delete. A shop is suspended or closed, never dropped.

## Steps

Size: S small, M medium, L large.

### Step 0 - Write the decision down (S) - done 2026-11-12

- ADR 0029 is written and the owner approved it. It replaces the "one shop per server" sentences of ADR 0023 and ADR 0024 in part.
- The first paragraph of CLAUDE.md, the long-term goal line of the spec, the notes in ADR 0023 and ADR 0024, and row OS4 of `docs/accounting-assumptions.md` were updated together with Step 1.
- Control tables are platform tables, not shop records: no `server_seq`, no sync. The "every table has the base columns" test only checks shop databases.

### Step 1 - Control database (M) - done 2026-11-13

What was built:

- `apps/api/drizzle-control`: its own migrations, with their own Drizzle configuration (`drizzle-control.config.ts`, `pnpm --filter @fabric/api db:generate:control`, `make migrate-new NAME=... CONTROL=1`). The folder is listed in the `files` of `apps/api/package.json`, so the production image contains it.
- With `MULTI_SHOP=true` the API, and `make migrate`, make the database named by `CONTROL_DATABASE_NAME` (default `fabric_control`) on the server of `DATABASE_URL` if it is missing, migrate it, and only then migrate the shop. The login must be allowed to create databases. Two processes that start together both end with the database. With the flag off nothing is made.
- Tables `shop`, `shop_host`, `shop_setup_code` and `shop_event`, with the rules of ADR 0029 section 2 and its amendment: nothing is deleted, what identifies a row never changes, a closed shop stays closed, `shop_event` is append-only, a host is a valid lower-case name and unique among the hosts in use.
- `ControlDatabase` (in `ControlDatabaseModule`): its own pool of 3 connections with a connect timeout of 10 seconds. No request uses it yet. Its first user arrives in Step 2.
- Pools: every pool has an `error` listener. The connect timeout is set only on pools that multi-shop mode makes, because pg-pool also counts the wait for a free connection in it (ADR 0029, amendment).
- `.env.example` and the two compose files carry `MULTI_SHOP` and `CONTROL_DATABASE_NAME`.
- Tests: `apps/api/test/control-database.e2e-spec.ts` makes the control database from nothing, migrates it twice and compares the two results, and tries every guard and constraint. Unit tests cover the pool options, the quoting of a database name and the database URL.

Done: the test makes the control database from nothing and migrates it twice with the same result. The whole existing API suite passes with the flag off and no change to any of its tests.

### Step 2 - Tenant router (L), the core of the work - done 2026-11-13

- `ShopPools` in `apps/api/src/database/`: one lazy pool for each shop database (5 connections, connect timeout, `error` listener, idle ones close). It closes them on shutdown. The URL of a shop is `DATABASE_URL` with the database name of the shop.
- A binding for each request (an AsyncLocalStorage store) that `TransactionHost.db` reads. It is made once for each request, before any database work. Entering a second shop inside a request throws, because `run()` joins an open transaction and would silently use the wrong database. A `runAsShop(slug, work)` helper is for scripts and tests. Without a shop, `TransactionHost` throws. The advisory write lock stays, and it is now per shop.
- `apps/api/src/modules/shops`, public only through its `index.ts`: the control repository, the lookup with its 30-second cache, and the host step. `app.module.ts` registers the host step. It answers as in "How a request finds its shop".
- The access token gets a `shop` claim (`token.service.ts`). `AuthGuard` reads the shop of the request from the binding in `database/`, not from the `shops` module, to avoid an import cycle. The order is: the host step has run, check the signature, compare `claims.shop` with the shop of the request (a difference gives 401), and only then read the session and the user from that shop's database. Decide with a test whether to sign each shop's tokens with a key derived from the secret and the shop id (HKDF).
- The throttler key becomes the shop id plus the client address.
- `packages/contracts`: the `shop` claim, and the shop id in the answers of login, refresh and registration status. Web: the client keeps the shop id from its first sign-in and stops syncing, with a message, when the server answers with another id (owner decision 6). With no id from the server it checks nothing. Texts in both languages.
- `MULTI_SHOP=false`: one shop, the database in `DATABASE_URL`, no control database read, no claim. Same as today.
- Lower the pools of the test suite, so that tests with many shops do not hit "too many clients".

Done when: an API test with two shop databases proves that sign-in works in each, that shop A's token on shop B's address gives 401, that an unknown address gives 404, that a suspended shop gives 403 and a shop that is being made gives 503, that a nested binding throws, and that with the control database down a cached host is still served while a host never seen gives 503. Also check three things: after this step an old access token (with no `shop` claim) is refused once, and the web app must refresh by itself, not sign the user out; the original address reaches the API through the Next proxy used in dev and e2e, and the browser keeps the cookies of `shop2.localhost` apart from those of `localhost` (assumption A1); and the client stops syncing when the shop id changes.

What was built (the details and the three places where the code differs from the text above are in the ADR amendment of 2026-11-13):

- `database/shop-binding.ts` (`bindShop`, `currentShop`), `database/shop-pools.ts` (`ShopPools`), and `TransactionHost`, which now takes its pool from `ShopPools`. The `DB` and `PG_POOL` tokens are gone. `SHOP_POOL_MAX` sets the size of a shop pool (default 5).
- `apps/api/src/modules/shops`: `ShopsRepository`, `ShopLookup` (the cache), `ShopHostMiddleware`, `ShopsService.runAsShop`, and `ShopsModule`, which registers the host step itself and is imported only when `MULTI_SHOP=true`.
- `TokenService` signs with a key for each shop (HKDF), puts the `shop` claim in the token and compares it. `ShopThrottlerGuard` counts for each shop. Login, refresh and the sign-up status carry `shopId`.
- Contracts: `shopId` in `accessTokenResponseSchema` and `registrationStatusSchema`, the error code `service_unavailable`, and `SHOP_ISSUES.suspended`.
- Web: the shop check in `Session`, the sync state `wrong_shop`, and the texts in both languages.
- Tests: `test/shops-routing.e2e-spec.ts` (two shops, plus a suspended, a being-made, a closed and a released address), `test/support/multi-shop-app.ts`, and unit tests for the binding, the pools, the lookup and the web client.

Done: every point of "Done when" is a test. Two of the tests were checked by taking the code away: without the claim comparison, and without the shop in the throttler key, each fails. The whole existing API suite passes with the flag off and no change to any of its tests. The Next proxy was checked in the source of Next 16.4.3 (it sends the original `Host` as `X-Forwarded-Host`), and a test sends such a request. The refresh cookie has no `Domain`, so a browser keeps it for one host name; this was not run in a real browser.

### Step 3 - Migrations for every shop (S) - done 2026-11-13

- `main.ts` migrates the control database, then each shop that is not closed, one after the other. A lock on each database stops two migrators from running together (for example `make migrate` while the API starts).
- If one shop's migration fails, that shop answers 503 and the failure is logged loudly. The other shops keep serving, and the shop is never served by code that expects a schema it does not have. `/health` does not change.
- `make migrate SHOP=<slug>|all`.
- Releases follow expand-then-contract: a migration that the previous code cannot read is not shipped in the same release as the code that needs it. Before any run that has migrations to apply, the operator takes a dump of every shop and of the control database.
- Measure how long it takes to make a shop and migrate it from nothing (assumption A3).

Done when: a test with two shops, one with a broken migration, keeps the healthy shop up, and a second migrator waits for the lock.

What was built (the details and the differences from the text above are in the ADR amendment of 2026-11-13, "Step 3"):

- `runMigrations` takes a lock on the database (`MIGRATION_LOCK`) and holds it while it migrates, so a second migrator waits. It is the same function for the one-shop server.
- `migrateShops(config, slug?)` migrates every shop that is not closed, one after the other, in the order they were made. A failure is logged with the database's own reason and returned, never thrown. `main.ts` calls it after the control database when `MIGRATE_ON_START` is on; in multi-shop mode it no longer migrates the database of `DATABASE_URL` itself.
- `ShopSchema` asks a shop's database whether it has every migration of this code, and `ShopLookup` makes that part of its 30-second answer. A shop that is behind answers 503 `service_unavailable` ("This shop is being updated") and is served again by itself within 30 seconds of its migration being fixed and run.
- `make migrate SHOP=<slug>|all` (`migrate-command.ts`): with the flag on the shop must be named, with the flag off `SHOP` is refused. Exit code 1 if any shop asked for failed.
- Tests: `test/shop-migrations.e2e-spec.ts` (17 tests) and three more in `shop-lookup.spec.ts`.

Done: both points of "Done when" are tests. One shop with a broken migration (a table that is in the way of the first migration) is left as it was and answers 503, while the healthy shops are migrated and served, `/health` answers, and the failed shop is served again after the cause is removed and it is migrated again, with no restart. A second migrator waits for the lock (it calls `onWait`, does nothing while the lock is held, and finds nothing to do after); three migrators that start together apply each migration once. Taking the lock out makes two of these tests fail, and making the schema check always say yes makes two others fail. A3 was measured: making a database and applying all 35 migrations took 0.6 to 1.1 seconds on a laptop (four runs, a PostgreSQL 16 container). It was not measured on the server; every shop's log line says how long its migration took, so the real figure will be in the log at Step 10.

Note for Step 5: `SHOP=all` means every shop, so `shop-new` must refuse the slug `all` (add it to the reserved names). `shop-list` can show "a shop whose migration failed" with `isMigrated`, the same check the lookup uses.

### Step 4 - Adopt the live shop as shop 1 (S) - done 2026-11-13

- `make shop-adopt SLUG=<name> HOST=<the address devices use today>` makes the control database if it is missing, adds a row for the existing database (`POSTGRES_DB`) and the address, and marks the shop `active`. It only reads the shop database. It moves no row and changes nothing inside it.
- It writes a `shop_event`. What the operator does goes there, not into a shop's `audit_log`.
- Try it first on a restored copy of a real backup (`make backup-verify` shows how).

Done when: with `MULTI_SHOP=true` and shop 1 adopted, the whole existing API e2e suite and the browser e2e suite pass with no change to the specs.

What was built (the details and the differences from the text above are in the ADR amendment of 2026-11-13, "Step 4"):

- `adoptShop` (`database/shop-adoption.ts`), `adoptCommand` (`shop-adopt-command.ts`) and the program `shop-adopt.ts` behind `make shop-adopt SLUG=... HOST=...`. It runs with `MULTI_SHOP` off (the rollout adopts first and flips the flag after): the program builds its configuration with the flag forced on. The shop's database is read through a read-only session, a database with no Fabric schema is refused before the control database is made, and three rows (`shop`, `shop_host`, `shop_event`) are written in one transaction. Again is safe (`already`), and every conflict is refused with its reason.
- `withMigrationLock`: the lock of Step 3, now also taken by the control migrations. This fixes a fault of Step 1: two commands that prepared the control database together could crash on the catalog.
- The adopted mode of the tests: `TEST_SHOPS=adopted` for the API suite (`pnpm --filter @fabric/api test:e2e:adopted`, `vitest.adopted.config.ts`, `test/support/one-shop-only.ts`) and `E2E_SHOPS=adopted` for the browser suite (`pnpm --filter @fabric/web test:e2e:adopted`). CI runs the API one.
- Tests: `test/shop-adopt.e2e-spec.ts` (26 tests) and one more in `test/control-database.e2e-spec.ts`.

Done, with two differences from the text of "Done when" that the owner should know:

- **The API suite.** Normal mode: 441 tests pass. Adopted mode (`TEST_SHOPS=adopted`, the same spec files, none changed): 338 pass and 7 are skipped, each with its reason in `test/support/one-shop-only.ts`: two are the block that tests a one-shop server, four assert the exact JSON `{ open }` of the sign-up status (a multi-shop server also gives `shopId`, Step 2), and one counts an attempt made by the test before it. Their multi-shop shape is tested in `test/shop-adopt.e2e-spec.ts` (26 tests). The alternative to skipping is to change those four assertions to `toMatchObject`; that changes the specs, so it is the owner's to ask for.
- **The browser suite is not green at HEAD, with or without the flag.** The same 12 tests fail in plain mode and in adopted mode, and the same 116 do not run (the responsive specs need data that the failed ones were to make): `language.spec.ts` (stale), and the partner chain, which starts with `partners.spec.ts` because `accounts.spec.ts` leaves a partner with no owner behind, so the setup it expects is not shown (a run of just those two specs fails the same way with the flag off). Adopted mode adds one failure, the sign-up test that asserts `{ open: false }` exactly (the same `shopId` case; skipped in adopted mode by `grepInvert` in `playwright.config.ts`, the spec unchanged), and `product-workspace.spec.ts:154` failed once in the full adopted run and passed in plain mode and when run alone in adopted mode (it took 27 seconds: a timing flake of the baseline). So, with the multi-shop server and shop 1 adopted, the browser suite gives the result it gives without it. Making the baseline green (`accounts.spec.ts` should remove the partner it adds, or the partner specs should not need an empty shop) is a change to the specs and is not part of this step.

Two proofs were made by taking the code away: a write put into the read-only inspection fails the "changes nothing inside the shop" test, and taking the lock out of the control migrations fails the "two adoptions start together" test. What was not done: the command was not tried on a restored copy of a real backup (none was at hand; Step 10 does it with the live shop's dump before the flag is turned on), and `make shop-adopt` was not run through `docker compose exec` on a real stack; the same program (`dist/shop-adopt.js`) is what the browser suite runs.

Note for Step 5: `shop-new` uses the same `SHOP_SLUG_PATTERN`, `SHOP_HOST_PATTERN` and `RESERVED_SHOP_SLUGS` (exported from `control/schema.ts`). Adding a second address to a shop is Step 5's: adopting refuses it on purpose.

### Step 5 - Create and manage shops (M) - done 2026-11-13

- Only the operator makes shops, with server commands. There is no operator web page, no operator role and no route in the API. A shop's own owner cannot make shops.
- `make shop-new SLUG=... [HOST=...] LABEL="..."` is a series of steps, because `CREATE DATABASE` cannot run in a transaction. Each step first checks whether it was already done, so the command can be run again: insert the control row (`provisioning`), create the database, run all migrations, add the address, make a setup code, set the state `active`. If it fails half way, the row stays in `provisioning` and the next run continues. It never drops a database by itself.
- The slug must match `^[a-z][a-z0-9_]{2,30}$` and not be reserved (`www`, `api`, `app`, `admin`, `control`, `all`, ...). The database is named `shop_<slug>` and quoted as an identifier. The command and the CHECK constraints of the control database both enforce this.
- `make shop-list` (states, and a shop whose migration failed), `make shop-suspend SLUG=... REASON=...`, `make shop-resume SLUG=...`, `make shop-code SLUG=...` (a new code, only while the shop has no live owner). Every one writes a `shop_event`.
- A suspended shop answers every route except `/health` with 403 `shop_suspended`: sign-in, refresh and sync too. Its tablets keep selling offline and sync after a resume. A sale at the till is never blocked by a billing state. Suspension takes effect within 30 seconds, because of the lookup cache (assumption A5).
- `closed` is final. The address stops answering and the data stays. Dropping a database is a separate manual decision after an export, and it is not built.

Done when: tests show that a duplicate slug is refused, that a failure half way can be run again and ends with the same result, that suspend and resume take effect within the cache time, and that nothing is deleted.

What was built (the details and the differences from the text above are in the ADR amendment of 2026-11-13, "Step 5"):

- One program, `shop.ts`, behind `make shop-new`, `shop-list`, `shop-suspend`, `shop-resume`, `shop-code`, plus two commands the plan did not list: `shop-host` (a second address for a shop) and `shop-close` (the way to reach `closed`, with `REASON` and `CONFIRM=<slug>`). The rules are in `shop-commands.ts`; the work is in `database/shop-provisioning.ts`, `shop-management.ts`, `setup-code.ts`, `shop-names.ts` and `control/operate.ts`. Runbook: [docs/runbooks/shops.md](runbooks/shops.md).
- `shop-new` is five steps that each look at whether they were done: the row (`provisioning`), the database, the migrations, the address, then the setup code and the state `active` together in one transaction. A run that stopped is run again with the same arguments and goes on. It refuses, before it writes anything, a bad or reserved name, a name in use, a database or address that another shop has, and a database called `shop_<slug>` that no shop owns.
- The setup code (12 characters of a 32-character alphabet, shown once as `ABCD-EFGH-JKMN`, kept only as an HMAC with the new `SETUP_CODE_SECRET`, valid 7 days) and its helpers `newSetupCode`, `formatSetupCode`, `normalizeSetupCode`, `hashSetupCode`. A new code stops the one that is waiting (`shop_setup_code.revoked_at`, control migration `0002`).
- `shop-list` with a `schema` column (`current`, `behind`, `no database`, `unreachable`), the owner and the code that is waiting; it writes nothing. `createPool` got a `readOnly` option for it.
- Tests: `test/shop-management.e2e-spec.ts` (65 tests) and unit tests for the code, the names and the new setting (67).

Done: all four points of "Done when" are tests. A duplicate slug is refused for an active, a suspended, a closed, an adopted and a just-finished shop, and so are a database name, an address and a database of another shop, with nothing written or made. A failure half way (a table in the way of the first migration) leaves the shop `provisioning` and unserved; the same command after the cause is removed ends with the same schema, the same events and the same state as a clean run, and it does the same from "row only", "database only" and "address added" (and two runs at the same time give one active shop and one code). Suspend and resume take effect once the cached answer is 30 seconds old (403 `shop_suspended` on sign-in, refresh, sync and a plain route; `/health` unaffected; the same the other way), proved through the real application with a clock moved forward. Nothing is deleted: the ids of every control table only grow across all the commands, a closed shop's database and rows are still there, and the guards refuse a `DELETE`. Seven proofs were made by taking the code away: removing the duplicate check, the second state check, the stopping of the old code, the confirmation of `close`, the state change of `suspend`, the expiry condition of the code, and the resuming of a `provisioning` shop each fail the tests named for them. API suite: 573 tests pass in normal mode (441 before this step); in adopted mode (`TEST_SHOPS=adopted`, no spec changed) 403 pass and the same 7 as in Step 4 are skipped.

What was not done, and decisions for the owner:

- **Not run on a real stack.** The commands were run through `shopCommand` against a real PostgreSQL, not through `docker compose exec`; `make -n shop-new …` shows the exact command each target runs. Step 10 runs them on the server.
- **`SETUP_CODE_SECRET` is optional at start in this step.** The two commands that make a code refuse without it. Step 6 needs it to check a code, so it decides whether the server refuses to start with `MULTI_SHOP=true` and no secret.
- **An address is never released.** Closing a shop keeps its addresses, so none can be given to another shop. There is no command that releases one; the owner decides if and when one is wanted.
- **No default address** is made from the slug (the open point of the list below): the operator gives `HOST` or uses `shop-host`.
- **A resumed `shop-new` keeps what the first run wrote** (the label, the database name) and adds the address if a new one is given. It does not rewrite the label.
- **Dropping a database** is still a manual decision after an export and no command does it.

Note for Step 6: use `normalizeSetupCode` and `hashSetupCode(secret, shopId, code)` from `database/setup-code.ts`, and the same `SETUP_CODE_SECRET`. A code is valid only if `used_at` and `revoked_at` are null and `expires_at` is in the future. `shop_setup_code.failed_tries` and the per-address limit are Step 6's. A shop waits for its owner when it is `active` and has no live owner (`app_user` with `role = 'owner'` and no `voided_at`), the same fact `shop-code` and `shop-list` read.

### Step 6 - Registration with a setup code (M) - done 2026-11-13

- The setup code has 12 characters from an alphabet of 32 (60 bits) and is shown once, on the operator's terminal. Only an HMAC of it is stored, made with a secret of the server (its name is fixed in this step). It is valid for 7 days and for one use, and the operator can make a new one. Failed tries are limited for each shop and for each client address.
- `GET /auth/registration` tells the page whether the shop of this address waits for its owner, and that a code is needed. A shop waits for its owner when it is `active` and its database has no live owner. That fact is derived, never stored.
- `POST /auth/register` gets a `setupCode` field (`@fabric/contracts`). The order is: check the code without using it, run today's `RegistrationService.register` unchanged (owner, audit entry and the four settings in one transaction), then mark the code used. If marking fails nothing is lost, because the partial unique index refuses a second owner. It fails closed. `OWNER_SIGNUP_ENABLED=false` still closes registration for the whole server, even for the holder of a code.
- A wrong or old code gets the same answer as a closed sign-up.
- Web: the first sign-up step shows the code field only when a code is needed. Texts in both languages. Loading, empty, error and offline states stay. The notice screen for a suspended shop is a separate decision that ADR 0029 does not make.

Done when: API tests cover a right, a wrong, an old and a reused code, a suspended shop, and two sign-ups that race. A browser test runs the whole sign-up wizard on a new shop in Arabic and English. That test was impossible before, because the shared e2e shop always has an owner. A new shop has none.

What was built (the details and the decisions are in the ADR amendment of 2026-11-13, "Step 6"):

- `SetupCodes` (`modules/registration/setup-codes.service.ts`): `check` before the owner is made, `use` after. It exists only on a multi-shop server (`RegistrationModule.forRoot`), and `RegistrationService` refuses to be built without it when the flag is on. One answer, the closed sign-up's, for every code that does not open the sign-up. 10 wrong tries stop a shop's waiting code for good (`shop.setup_code_locked`); 5 failed tries in 15 minutes block a client address (429, in memory, `failed-tries.ts`). `use` is one conditional `UPDATE` and writes `shop.setup_code_used`.
- `GET /auth/registration` gives `setupCodeRequired: true` while the shop waits for its owner; `POST /auth/register` takes `setupCode`. The shape of a code and what a person types (`normalizeSetupCode`, `formatSetupCode`, the alphabet) moved to `@fabric/contracts`, so the form reads a code as the server does; hashing and making stay in the API.
- The API does not start with `MULTI_SHOP=true` and no `SETUP_CODE_SECRET`.
- Web: the code field, first in the first step, only when the status asks for it; both languages; a refused code returns to the field and keeps what was typed; the same refused code is not sent twice. `session.registrationStatus()`, `useRegistrationOpen().setupCodeRequired`.
- Tests: `test/registration-setup-code.e2e-spec.ts` (30), `failed-tries.spec.ts` (5), `setup-code.test.ts` in contracts (7), the model and session tests of the web app, and `apps/web/e2e/signup-new-shop.spec.ts` (2).

Done: all points of "Done when" are tests. A right code makes the owner, the audit entry and the four settings, and the code is used (with its events). A wrong code, a badly shaped one, an old one (8 days, and the second of day 7), a used one (also after the owner was voided and the shop waits again), a replaced one, another shop's code and a shop with no code all get the answer of a closed sign-up. A suspended shop answers 403 `shop_suspended` once the cached answer is 30 seconds old, and inside those 30 seconds the sign-up is closed because the code's query joins the shop's state; its code is kept and works after a resume. Three rounds of three sign-ups at the same moment with one code give exactly one owner, one use event, and `[201, 403, 403]`. The browser spec runs the whole wizard on a shop made by `shop.js new`, in English and in Arabic: a badly shaped code is refused in the form, a well-formed wrong one is refused by the server and the wizard comes back to the code with the name still typed, and the right code, typed in lower case with spaces, ends signed in on `/home`. The API reports the shop open before and closed after, with no `setupCodeRequired`.

Suites: API 608 tests pass in normal mode (573 before this step); in adopted mode 433 pass and the same 7 as before are skipped (403 before; the new spec runs there too, and the owner-less sign-up specs of earlier steps pass unchanged because the harness adds a code); contracts 428; web unit 875 pass and the same 11 `tokens.contrast.test.ts` tests fail as at HEAD. Browser suite in adopted mode (`pnpm --filter @fabric/web test:e2e:adopted`): 98 pass, the two new ones among them; 13 fail, the 12 of the known baseline and `product-workspace.spec.ts:154`, which is the timing flake of the baseline and passes alone; the same 116 do not run. In plain mode the new spec is skipped (it needs the flag).

Eleven proofs were made by taking the code away, each from the API spec: skipping the hash comparison fails 9 tests; not marking the code used fails 7 (the race tests among them); taking the shop's `active` state out of the code query fails the "suspended within the cache time" test; never stopping a code at 10 tries fails the shop-limit test; never blocking an address fails 3. The conditions "not used", "not stopped" and "not run out" are written twice, in `check` and in `use`, and each copy covers for the other, so taking either one away alone fails nothing (the request is refused by the other, after the owner was written and rolled back); taking both away fails the used-code test, the old-code tests and the locked-code test. That is a defence in depth, not a gap, and it is why the three were checked in pairs.

What was not done, and decisions for the owner:

- **The address limit is in memory.** A restart clears it, and one office or mobile network is one address. A shared counter is the alternative if the owner wants one.
- **One address can still lock a shop's code** in two windows (5 + 5 tries in 30 minutes). The operator makes a new code with `make shop-code`. Nothing else is exposed: no code, no owner can be made.
- **The code is marked used before the shop transaction commits.** If that commit fails the code is burnt and no owner exists; `make shop-code` fixes it. The other order leaves an owner and a code that still works.
- **A locked code is not a cool-down.** The operator makes a new one. A timed lock was rejected as it only helps a guesser who waits.
- **The notice screen for a suspended shop is not built**, as the plan said. A suspended shop's sign-up answers 403 and the page shows its error.
- **The browser spec needs the flag** (`E2E_SHOPS=adopted`), so `make e2e` in plain mode skips it. `make e2e` has no adopted target yet; the command above runs it.
- **Not run on a real stack**: `shop-new` and the sign-up were run through the program and a built API against PostgreSQL in a container, not through `docker compose exec` on a server. Step 10 does it.

Note for Step 7: the sign-up needs the address of the request and the real client address. Caddy in front must send `X-Forwarded-Host` and `X-Forwarded-For`; `trust proxy` already accepts loopback and private ranges, and the address limit reads the client through it. If Caddy's address is public or not in those ranges, every client looks like one address and 5 failures block them all.

### Step 7 - HTTPS for many addresses (M) - done 2026-11-13

- `infra/docker/caddy/Caddyfile`: a catch-all HTTPS site with on-demand TLS. (Built as a wildcard site `*.{$PLATFORM_DOMAIN}`: a site with no name broke the bare-IP shop. See "What was built".) Before Caddy asks Let's Encrypt for a certificate, it asks the API: `GET /internal/known-host?domain=<host>` answers 200 only for the names of shops that are not closed, and 404 for IP addresses, so the bare-IP site of shop 1 keeps its present certificate.
- The route is public as `/api/internal/known-host`, because Caddy removes the `/api` prefix. So it has two layers: the site block of Caddy answers 404 for `/api/internal/*`, and the route refuses any request with an `X-Forwarded-For` header, because every request through the proxy has one. Caddy's own `ask` request goes straight to `http://api:4000/internal/known-host` on the Docker network (assumption A2: check the exact syntax and this behaviour in the Caddy documentation for the installed version, 2.11.7).
- DNS: one wildcard `A` record, `*.yourdomain.com`, to the server. This is fine for addresses. A wildcard certificate is not used, because it needs a DNS plug-in that the stock Caddy image does not have. Each name gets its own certificate, made on demand. Let's Encrypt allows 50 certificates for each registered domain each week, so the shops made in one week stay below that.
- `.env.example`: `PLATFORM_DOMAIN`.
- The deploy runbook states the security rule of this design: the API port is never published and never reachable from outside the Docker network. Only then can the address header be trusted.

Done when: locally (with Caddy's own CA) a new shop's address works at once, with no Caddyfile edit and no restart, and a random name gets no certificate. `/api/internal/known-host` from outside gets 404, and the route refuses a proxied request. The real Let's Encrypt check happens in Step 10.

What was built (the details and the decisions are in the ADR amendment of 2026-11-13, "Step 7"):

- `GET /internal/known-host?domain=<name>` (`modules/shops/known-host.controller.ts`, `ShopsService.hasOpenShopAt`): 200 with an empty body for the address of a shop that is `active`, `suspended` or `provisioning` and not released; 404 for everything else, every IP address included; 404 for any request with `X-Forwarded-For`, checked first; one body for every refusal; 400 for a missing, empty or too long name. Read from the control database each time, no cache. Public, outside the host rule, not in the OpenAPI document, and only with `MULTI_SHOP=true`.
- `Caddyfile`: `on_demand_tls { ask http://api:4000/internal/known-host }`, a shared snippet `(shop)` for the two sites, `/api/internal/*` answered 404, the bare-IP/`{$DOMAIN}` site as before, and `*.{$PLATFORM_DOMAIN}` with `tls { on_demand }`.
- `PLATFORM_DOMAIN`: in `.env.example` and in `compose.prod.yml` (`platform.invalid` when unset, so a one-shop server gets no certificate for any name). `make shop-new SLUG=aziz` also uses `aziz.<PLATFORM_DOMAIN>` as the address when `HOST=` is not given.
- `compose.prod.yml`: a comment on `api` that it has no `ports:` and must never get one. `docs/runbooks/deploy.md`: the new section "Many shops: HTTPS for each shop's address" (the DNS record, how it works, the Let's Encrypt limits, the security rule with its three checks, what to look at after the first shop). `shops.md` and `.env.example` point to it.
- Tests: `test/known-host.e2e-spec.ts` (27).

Done: on Caddy 2.11.7 in Docker with `local_certs` and the real API, a shop made with `shop.js new` was served at its address with a certificate on the next request, with no Caddyfile edit and no restart; the same name before the shop existed, a random name under the domain and a name outside it got no certificate; the bare IP opened; a suspended shop's address got a certificate and the API's 403; a closed shop's address got none. `/api/internal/known-host` through Caddy got 404 in eight spellings, and each of the two layers held alone (Caddy's block alone, the API's check alone). Assumption A2 held: Caddy's `ask` is a GET with `?domain=`, the host `api:4000` and no `X-Forwarded-For`; any 2xx goes on.

Suites: API 635 tests pass in normal mode (608 before this step, plus the 27 of the new spec); in adopted mode 460 pass and the same 7 are skipped (433 before; the new spec runs there too). Eight proofs were made by taking the code away (the ADR amendment lists them), and two on the stack (the API's refusal off; the Caddy block off).

What was not done, and decisions for the owner:

- **A wildcard site, not a catch-all.** The plan said a catch-all site. It was built and run, and it broke the bare-IP shop: Caddy asks the API about the default name of a visit that sends no server name, the API says no to an IP, and the handshake fails. So only names directly under `PLATFORM_DOMAIN` get a certificate. A shop at its own domain would need one more site address in the `Caddyfile`; that is not built. Say if the owner wants it.
- **Not run on Let's Encrypt, a real DNS wildcard or a real server.** Only Caddy's own authority was used. The limits are as published. Step 10 does it.
- **No rate limit on the `ask` route.** A name that is not a shop costs one indexed read of the control database and nothing at Let's Encrypt.
- **The Caddyfile is not checked in CI.** `caddy validate` works on it; adding the step is small.

Note for Step 8: nothing in the backup work depends on this step. The API port rule is in `deploy.md`; do not add a `ports:` to `api` when the backup service is changed.

### Step 8 - Operations for each shop (M) - done 2026-11-13

- The nightly backup (`infra/docker/backup/nightly.sh`) reads the list of shops from the control database. It dumps every shop that is not closed (suspended ones too) to `/backups/<slug>/<database>_<UTC>.dump`, keeps the newest 14 in each directory, and then dumps the control database into its own directory. Pruning works on one directory at a time, because the old pattern would mix `shop` and `shop_two`.
- `make backup-verify` restores a fresh dump of each shop into a scratch database and compares row counts.
- `make backup`, `make restore`, `make export` and `make import` get `SHOP=<slug>`. A restore must name the shop. It stops `api` and `web`, so every shop is offline for a few minutes while one shop is restored. The tablets keep selling offline. After a restore the shop gets a new `server_instance` row, so its devices pull again and keep their unsent changes. A restore of one shop while the API runs is later work.
- `make owner`, `make partner-user` and `make cashier-user` get `SHOP=<slug>` and run inside `runAsShop`.
- Runbooks: `deploy.md`, `backup.md`, `api.md`, and a new `docs/runbooks/shops.md` (make a shop, suspend one, a lost setup code, move a shop to another server). Rotating `JWT_ACCESS_SECRET` signs out every shop, and the runbook says so.
- Measure how many shops fit in the API process on the owner's server (A4) and how long the nightly dump takes (A6).

Done when: restoring yesterday's dump of shop A leaves shop B's row counts the same, the nightly job writes one dump for each shop and one for the control database, and pruning one shop never touches another shop's dumps.

What was built (the details and the decisions are in the ADR amendment of 2026-11-13, "Step 8"):

- `apps/api/src/shop-scope.ts` and the five commands: `make owner`, `partner-user`, `cashier-user`, `export` and `import` take `SHOP=<slug>` and run inside `runAsShop`. On a many-shop server a missing `SHOP` is exit 2 before anything is read; an unknown or closed shop is exit 1; on a one-shop server `SHOP` is refused (exit 2). `make export` writes `backups/<slug>/export_<UTC>.json` with a shop.
- `infra/scripts/backup.sh` and `infra/docker/backup/nightly.sh`: one folder for each shop that is not closed (suspended too) and `control/`, the newest `BACKUP_KEEP` kept in each, rotation that matches only `<database>_<UTC time>.dump` in one folder. A shop being made without a database is skipped. One failed shop does not stop the others; the control database is always tried; the run ends as a failure. `compose.prod.yml` gives the backup service `MULTI_SHOP` and `CONTROL_DATABASE_NAME`.
- `infra/scripts/restore.sh`: `SHOP=<slug>|control`; the dump must be of that shop's own database (`FORCE_DB_MISMATCH=1` for a move); the shop's name is typed to confirm; `api` and `web` stop and start again also on failure; a new `server_instance` row; `shop.restored` in the control database's `shop_event`. `verify-backup.sh`: a fresh dump of each shop and of control restored into `<database>_restore_check` and counted.
- `lib.sh`: `backup_targets`, `dump_database`, `latest_dump` and the others the scripts share. `Makefile`: the `SHOP` variable and its help text.
- Runbooks: `backup.md` (a section for many shops), `deploy.md` (the backup service, rolling back, `JWT_ACCESS_SECRET`), `api.md` (`SHOP` on the account commands, the secrets), `shops.md` (a lost setup code, back up and restore a shop, move a shop to another server, `shop.restored`).
- Tests: `src/shop-scope.spec.ts` (7), `test/shop-scope.e2e-spec.ts` (4), `test/nightly-backup.e2e-spec.ts` (7).

Done: on a scratch stack with five shops and the control database (one of the shops suspended, one closed, one being made), the one-shop scripts behave as before; `make backup` writes one dump for each open shop and one for control; rotation of one shop leaves the folders of the others identical, and a decoy file survives; the real `nightly.sh` in `postgres:16.15-alpine` does the same and keeps going when one shop's database is missing. Restoring yesterday's dump of shop A took its customers from 9 back to 5, gave it a second epoch and wrote `shop.restored`, with the main shop, shop B and shop C unchanged (customers, epochs, audit rows). `backup-verify` passed for every database and left no scratch database. The refusals (another shop's dump, a closed shop, no `SHOP`, `SHOP` with a scratch database, a wrong confirmation) changed nothing.

Measured (ADR amendment, 6 and 7): A3, a shop is made and migrated in 1.3 to 2.2 seconds. A4, the limit on shops in one API process is the connections of PostgreSQL, not memory: about 300 MB at start, under 1 MB for each shop used, and a peak of shops times the requests at once on each (up to `SHOP_POOL_MAX`); 30 shops with 3 requests at once on each used 90 of the 100 connections and nothing failed, with 5 at once the connections ran out and 54 of 150 requests got a 500. Idle shops hold no connection. A6, the nightly dump takes 0.17 seconds for each database with an empty schema and about 50 MB of database for each second where there is data (a 382 MB shop: 7.5 seconds, 119 MB; restore 5.4 seconds). All on a developer machine; the owner's server is Step 10.

Suites: `pnpm test` in `apps/api`, 55 files and 653 tests pass (635 before this step, 18 new, no existing spec changed). `pnpm test:e2e:adopted`, 40 files, 471 tests pass and 7 are skipped as before (460 before, 11 new). `tsc`, `eslint` on the files of this step, `prettier` and `make deps` are clean; the scripts pass `sh -n` and `bash -n`. The web suites are not touched by this step.

What was not done, and decisions for the owner:

- **Every shop is offline while one shop is restored.** `restore.sh` stops `api` and `web`, as the plan says. It took 5 seconds for a 382 MB shop here. Restoring one shop while the API runs (suspend it, restore it, resume it) is later work; say if the owner wants it before the first customer.
- **"Too many clients" is a 500.** When PostgreSQL runs out of connections the API answers 500, not 503, and nothing says which shop was refused. With the default `max_connections` (100) and `SHOP_POOL_MAX=5`, about 30 shops fit with 2 or 3 requests at once on each. Above that, raise `max_connections` or lower `SHOP_POOL_MAX`. Not changed: it is a setting for the owner to choose, and the real numbers come in Step 10.
- **Rotating `JWT_ACCESS_SECRET`** does not sign anyone out (as the plan said it would): it stops every shop's access tokens at once and each device renews with its refresh cookie. All the shops refresh together, so do it when they are quiet. The runbooks say this.
- **The lost-server rebuild and the move of a shop between two servers** are written from commands that were each run, not rehearsed as a whole (Step 10).
- **A restore of the control database writes no event** (it would go into the database that was just replaced).
- **The scripts are checked by running them**, not by `shellcheck` (not installed here); a CI step for it is small.
- **`CLAUDE.md`'s commands table** still describes `backup`, `restore`, `export`, `import`, `owner`, `partner-user` and `cashier-user` without `SHOP`. That is Step 9's.

Note for Step 9: `SHOP=<slug>` is how every command names a shop, and `ShopsService.runAsShop` is how a test binds one (`test/shop-scope.e2e-spec.ts` shows both). The accounts, backups and exports of one shop are tested to stay in that shop. The `CLAUDE.md` commands table is yours.

### Step 9 - Proof across shops (M) - done 2026-11-13

- API test: sign in to two shops. Write a customer, a product and a sale in shop A. Shop B's sync pull from 0 has none of them, and neither shop can read the other through any route.
- Browser e2e: the shared stack runs with `MULTI_SHOP=true` and shop 1 on `localhost`. A new spec makes shop 2 (Chromium resolves `*.localhost` to this machine) and runs on `http://shop2.localhost:3310`: the sign-up wizard, an offline sale, sync. Shop 1 is unchanged. The new spec uses its own database, so it cannot break the specs that share one.
- Docs: CLAUDE.md (the login rules and the commands table), `docs/MVP_ACCEPTANCE.md`.

Done when: `make check` and `make e2e` pass (the known red baseline excepted).

What was built (the details are in the ADR amendment of 2026-11-13, "Step 9"). Nothing in the server changed in this step; it is tests, one test helper, CI and docs.

- `apps/api/test/cross-shop.e2e-spec.ts` (13 tests): two shops in one API process, each with a customer, a supplier, a product, a purchase, a sale on credit, an expense and a shop name. The sync pull from the start of each has nothing of the other's (ids or names); every `GET` route of the OpenAPI document (46) is called in both shops and shows nothing of the other's, with a positive control so that an empty answer cannot pass for isolation; the two databases hold only their own rows (SQL), one owner each, and an audit log that names only its own ids; shop A's sale and its void pushed to shop B are refused; the same customer id written in B makes B's own record; a token of one shop gets 401 at the other. `MultiShopApp.shop(host)` is the new helper (one agent for each request, the shop's address on it, no cookie kept); `stockKit` takes `Pick<TestApp, 'http'>`.
- `apps/web/e2e/second-shop.spec.ts` (1 test), with `SECOND_SHOP` in `e2e/stack.ts` and a third shop made in `e2e/global-setup.ts`: the shop at `shop2.localhost` waits for its owner; the sign-up wizard with its setup code; a product; a sale with the Wi-Fi off, which drains by itself and reaches the shop's server (3,000 cents); a phone-sized second device that signs in and sees the product; the shared shop's pull from the start is the same before and after and holds nothing of the second shop; each owner is refused at the other's address.
- `make e2e-shops` and a CI step ("End-to-end (Playwright) as an adopted shop", `pnpm test:e2e:adopted` in `apps/web`). `make e2e` is unchanged.
- `CLAUDE.md`: a "Many shops" rule next to the login rules, and the commands table with `SHOP=` on the account, backup, restore, export and import commands and the new `make e2e-shops`. `docs/MVP_ACCEPTANCE.md`: a section for a server with many shops, to be ticked by hand once before a neighbour goes live.

Done: the cross-shop spec fails when `ShopPools` returns one pool for every shop (the second shop's owner cannot sign in), and passes with the real one. The second-shop spec passes alone in 5.6 seconds and in the whole adopted run (5.4 seconds), after the specs that fill the shared shop. Plain `make e2e` skips the three new browser tests.

Suites: `pnpm test` in `apps/api`, 56 files and 666 tests pass (653 before, 13 new, no existing spec changed). `pnpm test:e2e:adopted`, 41 files, 484 tests pass and 7 are skipped as before (471 before, 13 new). The whole browser run in adopted mode: 100 passed, 12 failed and 116 skipped (the responsive audit is opt-in). The 12 are the known red baseline: `language.spec.ts` (1), `partner-exit.spec.ts` (4), `partners.spec.ts` (2), `settlements.spec.ts` (2), `zakat.spec.ts` (1) and `zz-people.spec.ts` (2); none is a spec of this work. `tsc` and `eslint` (api and web), `prettier` and `make deps` are clean on the files of this step.

What was not done, and decisions for the owner:

- **Shop 1 is on `127.0.0.1`, not `localhost`.** The plan says `localhost`. Every spec reaches the API and the web server at `127.0.0.1`, and Step 4 adopted the shop for that address; the second shop is on `shop2.localhost`, which Chromium resolves without a setting. Say if `localhost` is wanted; it changes the address in `global-setup.ts` and nothing else.
- **`make e2e` still runs the one-shop server.** The plan says the shared stack runs with `MULTI_SHOP=true`. The adopted run is a separate target and a separate CI step, because the live server is a one-shop server until Step 10 and the specs that matter before it are the ones for that server. Say if `make e2e` should become the adopted run (the cost is that the whole browser suite runs only on the many-shop server).
- **The `shop` claim of the token is not proved on its own.** The key of each shop already refuses another shop's token with 401, so a test cannot tell whether the claim check is there. It is a second lock, left in.
- **Only `GET` routes are swept**, and a route for which no record was written shows nothing in either shop. The writes are covered by the sync tests and by the tests of writes that name the other shop's records.
- **The first shop's "unchanged" is empty when the browser spec runs alone.** It holds in both cases; the shop with records is the API spec's job.
- **The 12 browser failures** are the known baseline and are untouched.

Note for Step 10: the real proxy, DNS, certificates and the first neighbours are still to do, and only the owner can do them. `MVP_ACCEPTANCE.md` has the by-hand list for a server with many shops; run it on the owner's server before the first neighbour goes live.

### Step 10 - Roll out on the real server (S) - done 2026-11-13 (rehearsed; the live run is the owner's)

1. `make backup STACK=prod`, then copy the dump off the server.
2. Deploy the new tag with `MULTI_SHOP=false` (today's behaviour). Check the live shop.
3. Set `PLATFORM_DOMAIN`, add the wildcard DNS record, run `make shop-adopt` for shop 1 with the address devices use now, set `MULTI_SHOP=true`, then `make up STACK=prod` (one restart). Check sign-in, a sale and sync on the live shop. Devices need nothing: the first request with an old token gets a 401, the app refreshes once, and the new token has the `shop` claim.
4. `make shop-new SLUG=test`. Open its HTTPS address on a phone, sign up with the code, then `make shop-suspend SLUG=test`. This is the real Let's Encrypt check.
5. `make shop-new` for the first neighbour. Give them the address and the setup code, sit with them for the sign-up, install the app, and make one sale with Wi-Fi off. Then the second neighbour.

Rollback:

- Before the flag is on: do not turn it on. The code can be reverted, and the control database can be left or removed by hand.
- With shop 1 only: set `MULTI_SHOP=false` (or use the old `IMAGE_TAG`) and run `make up STACK=prod`. Shop 1's database never changed. Each device's access token (made with the flag on, signed with the shop's own key) gets one 401 and is renewed with the refresh cookie, so nobody types a password (rehearsed; ADR 0029, Step 10 amendment, 3).
- With shops 2 and more: close their addresses at the edge first (empty `PLATFORM_DOMAIN` and `make up STACK=prod`; rehearsed: every neighbour's name then fails with a TLS error and shop 1 still answers; or take them out of DNS). With the flag off the server does not read `Host`, so it would serve shop 1 under any name that still reaches it. Nothing is lost, because each shop is a whole database.
- After a migration that the old code cannot read: restore each shop from the dump taken just before it. What was written after that is lost on the server.

What was built. No code changed in this step: the repository got the runbook, and the ADR, the plan and three runbooks got corrections. The server of the owner, its DNS and Let's Encrypt cannot be reached from here, so the work was to rehearse every stage that does not need them and to write down exactly what the owner runs.

- `docs/runbooks/multi-shop-rollout.md` (new): five stages, each with its commands, its checks and its way back: a dump and a copy off the server; this release with the flag off; adopt, `.env`, one restart; a test shop on the real certificate; the first neighbour. Then "Ways back" for each stage, and a table of what to do when something differs.
- Pointers from `deploy.md` (the many-shops section and the Let's Encrypt limits), `shops.md` (what the move-a-shop note covers) and `backup.md` (the dumps from before the flag).
- ADR 0029: two inline corrections about tokens with the flag off, and the Step 10 amendment.

Rehearsal. A scratch copy of the production stack (`compose.prod.yml`: Postgres, API, web, Caddy, backup) with the previous release (`b62baa6`) first and then this tree, Caddy's own CA, the loopback for DNS. Run in order: the old release with real data; this release with the flag off (the shop's migrations are byte for byte those of the old release, so its database does not change); dump and verify; `make shop-adopt` in the running container; one edit of `.env` and one `make up`; the old access token (401), the refresh with the old cookie (new token with the `shop` claim), the shop's records unchanged across the flip (a pull from the start counted the same before and after); `make shop-new`, an address that gets a certificate on its first visit, sign-up with the code, `shop-suspend` (403 within 30 seconds) and `shop-resume`; a name that is not a shop (TLS error); backups of both shops and of `control/`; each rollback (flag off with shop 1 only, flag off after a neighbour exists in the wrong and in the right order, the old release) and a roll forward.

Measured: the API answered with an error or not at all for about 17 seconds while `make up` turned the flag on (`make up` itself took about 20 seconds). The roll back was not timed.

Found, and put in the runbook or corrected:

1. **A token made with the flag on is not ignored with the flag off; it gets a 401** (it is signed with the shop's key, which a server with the flag off does not use). The device refreshes once and goes on, so nobody types a password, but the sentence "nobody is signed out" in the ADR and in this plan was wrong and is corrected.
2. **With the flag off and `PLATFORM_DOMAIN` still set, a neighbour's address that already has a certificate opens shop 1.** The order for a roll back with neighbours is therefore: empty `PLATFORM_DOMAIN` and `make up`, check that a neighbour's address fails, then the flag.
3. **Dumps made before the flag stay in `backups/` and are never rotated.** Keep the last as the way back for a week, then delete by hand.
4. **The shop is adopted in the running container before the flag.** Then one edit of `.env` and one restart. Adopting after the flag would answer 404 `No shop is served at this address` on the live address until it was done.

Done: every stage of the plan that a repository can show was run on the production stack and passed, and the results are in the runbook as expected output. `make check` is as at Step 9 (no code changed).

What was not done, and decisions for the owner:

- **Not run: the real server.** Real DNS (the wildcard record), a certificate from Let's Encrypt (and its limits), the real phone and tablets, a browser tab held open across the restart, and the first neighbours. The first three are stage 4 of the runbook; the client's refresh code was read (`local-db/session.ts`) and the API side was run with `curl`, but a real browser session across the flip was not.
- **The slug of shop 1.** The runbook says `main`. It is the name typed in `SHOP=<slug>` for every later command, and it cannot be changed (a shop's identity never changes). Choose the one you want to type.
- **Old flat dumps.** They are kept, not rotated. Say if the backup service should delete them itself after the flip (it would be a change to `nightly.sh`, and a dump that is deleted by a script is a dump that is not there on the day it is needed).
- **The wildcard DNS record can be made today.** It changes nothing until `PLATFORM_DOMAIN` is set.
- **What the plan does not cover:** the moves of a shop between two servers and the rebuild of a lost server are still written from commands that were each run, not rehearsed as a whole.

### Audit after Step 10 (2026-11-13)

The owner asked for an audit and for what it found to be solved. What was run: typecheck, lint, `make deps` (no violations), formatting, every unit and API suite (core 693, contracts 428, config 27, API 666, web 886), the browser suite one-shop and adopted, `pnpm audit --prod`, and a read of the code that decides which shop a request is for (host step, `ask` route, tokens, setup codes, throttling, backup script). Nothing in the multi-shop code needed a change. Caddy 2.11.7 was checked to overwrite a client's `X-Forwarded-Host` and `X-Forwarded-For`, so a client cannot choose a shop with a header.

Solved: the 3 lint errors and 2 warnings of the web app (`language-toggle.tsx`, `theme-toggle.tsx`, `settings-shell.tsx`; the theme toggle's two labels now come from `messages.theme`, the language toggle keeps its English labels on purpose, because it names the language it switches to and `not-found.spec.ts` relies on them); the stale `language.spec.ts` (the language control is one "Switch to …" button now, and the password field has a "show" button, so its label needs `exact`); and the specs that failed after `accounts.spec.ts` (it now removes the partner it adds, once the login is off). The browser suite is green: 109 passed, 0 failed with one shop (119 skipped: the opt-in responsive audit, and the three multi-shop specs); 112 passed, 0 failed adopted.

Then solved, with the owner's approval ("I approve everything"): the 11 cases of `tokens.contrast.test.ts`. Five tokens in `globals.css` changed, each only enough to pass with some margin, hue unchanged: light `--muted-foreground` `#78716c` to `#6f6864` (4.85 to 5.47), light `--warning` `#a66b19` to `#976217` (4.81 and 5.15; `--debt` follows it), light `--input` `#d6d0c7` to `#8e8a84` (3.2 and 3.43), dark `--input` `#504748` to `#756e6e` (3.58 and 3.23), and a new dark `--estimated` of `var(--gold-500)` (7.68 and 6.94; the light value, gold-800, was 2.8:1 on the dark surfaces). The input border is the change that is seen: form borders are now clearly visible (WCAG 1.4.11 asks for 3:1; they were 1.4:1 light and 2.0:1 dark). `bg-input/…` tints and the unchecked switch track follow the same token. The test file and its thresholds are unchanged. A moderate advisory in `minimatch`, reached only through the ESLint plugins (development), is left.

## Later (not in this plan)

ADR 0029 does not decide these. Each needs its own decision when it is wanted.

- A public sign-up page that makes shops by itself (it needs payment or approval, and limits against abuse).
- Billing and plans.
- A web page for the operator instead of `make`.
- The management of custom domains for a shop (`shop_host` already allows many addresses).
- A limited database role for each shop instead of the Postgres superuser. It needs separate roles for migrations and for running.
- A restore of one shop alone, while the other shops keep running.
- The notice screen the app shows when the server answers `shop_suspended`.
- A staging shop to try each release before it reaches everyone.
- Above about 15 shops, with pools of 5 and Postgres' default of 100, raise `max_connections` or add a connection pooler.

## Watch out

- One app version serves all shops. A bug ships to everyone at once. Try each release on a staging copy first.
- A request with no known shop must fail. It must never open shop 1.
- Shops times 5, plus the control pool, a migration and a backup, must stay under Postgres `max_connections` (100 by default).
- A device that moves to a new address starts with an empty local database, and its unsent changes stay behind. Shop 1 keeps its current address. When a host name is added later, the old address stays mapped to the same shop, and devices move only after a full sync.
- An address is released, never moved to another shop. Never give a released name to a different shop while old devices may still use it.
- A slug may contain `_`, but a host name may not. Step 5 decided: no default address is made from the slug. The operator gives `HOST` or adds one with `make shop-host`.
- Only Caddy, on the private Docker network, reaches the API, so the address header can be trusted. Keep the API port closed to the internet.
- `/health` is public liveness with no database work. It must stay outside the host rule, or Docker marks the API unhealthy.
