# Runbook: making and managing shops

Only for a server that serves many shops ([ADR 0029](../adr/0029-multi-shop-database-isolation.md), Step 5 of [the plan](../MULTI_SHOP_PLAN.md)). Only the person who runs the server (the operator) makes, suspends or closes a shop, with the commands below. There is no operator web page, no operator role and no API route for it, and a shop's own owner cannot make shops. Every command writes a `shop_event` (who, when, what) to the control database; the operator's actions are never written to a shop's own `audit_log`.

The commands run `node dist/shop.js …` inside the running `api` container, as `make migrate` and `make shop-adopt` do. They work while `MULTI_SHOP` is still `false` in `.env`, so shops can be made before the flag is turned on. `STACK=prod` (or `dev`) picks the stack, as for every `make` target.

## Before the first shop

1. `SETUP_CODE_SECRET` is in `.env`. It is the key that setup codes are hashed with. Make one with `openssl rand -base64 48` (at least 32 characters), keep it out of git, and restart the stack (`make up STACK=prod`) so the `api` container has it. Without it `shop-new` and `shop-code` refuse to run, before they make anything, and **the API does not start with `MULTI_SHOP=true`**: the sign-up of a shop checks its setup code with this key, and a sign-up that cannot check a code must not open. Change it and every code that is waiting stops working; `make shop-code` makes a new one.
2. The database login in `DATABASE_URL` can create databases (the superuser of the Docker stack can). `shop-new` makes `shop_<slug>` on the same PostgreSQL server.
3. A live one-shop server is adopted first (`make shop-adopt`, see [the API runbook](api.md)). Nothing here changes an adopted shop.

## Make a shop

```
make shop-new SLUG=<name> [HOST=<address>] [LABEL="<note>"] [STACK=prod]
```

- `SLUG` is the shop's short name, the one typed in `SHOP=<name>` later: 3 to 31 characters, lower-case letters, digits and `_`, starting with a letter. `all`, `www`, `api`, `app`, `admin` and `control` are reserved. The database is called `shop_<slug>`.
- `HOST` is the address the shop is served at: the host name or the IP only, in lower case, with no `http://`, no port and no path. It can be left out and added later with `make shop-host`. When it is left out and `PLATFORM_DOMAIN` is set in `.env`, the address is `<slug>.<PLATFORM_DOMAIN>` (an underscore in the slug becomes a hyphen: `my_shop` is served at `my-shop.<PLATFORM_DOMAIN>`). The command does not make the DNS record or the HTTPS certificate. With the one wildcard DNS record `*.<PLATFORM_DOMAIN>` in place, a name under `PLATFORM_DOMAIN` gets its certificate from Let's Encrypt the first time it is opened, a few seconds, with no change to Caddy and no restart; any other host name gets none, and an IP address is served with Caddy's own certificate (see "Many shops" in [deploy.md](deploy.md)). Open the address of a new shop once yourself, before you hand it over.
- `LABEL` is your own note about the shop (up to 200 characters). It shows in `make shop-list`.

The command does these steps in order, and each one first looks at whether it was done already:

1. the shop's row in the control database, in the state `provisioning` (nothing serves it);
2. the shop's database;
3. all the migrations of the shop;
4. the address, if one was given;
5. a setup code, and the state `active`, together in one transaction.

It prints the setup code **once**, like `ABCD-EFGH-JKMN`. Only a hash of it is kept, so it cannot be shown again. Give it to the shop's owner, who types it on the sign-up page of the shop (see "The owner signs up" below); it works once and for 7 days. If it is lost, or may have been seen by someone else, `make shop-code` makes a new one and the old one stops.

**If it stops half way** (a migration failed, the server restarted, the terminal closed), the row stays in `provisioning`: the shop answers 503 or, with no address yet, 404, and nothing is lost. Fix the cause, then run the same command again with the same arguments: it goes on from where it was and prints the code at the end. `make shop-list` shows such a shop with the schema `behind` or `no database`. The command never drops a database and never deletes a row.

It refuses, before it writes or makes anything, when: the name is bad or reserved; a shop with that name exists already and is not being made (use `shop-code` or `shop-host` for it); the database `shop_<slug>` is the database of another shop; the address belongs to another shop; a database called `shop_<slug>` exists on the server and no shop owns it (it will not take over a database it did not make: pick another name or move that database away); or `SETUP_CODE_SECRET` is not set.

## See the shops

```
make shop-list [STACK=prod]
```

One line for each shop, oldest first: its state, its addresses, whether its database is up to date with this version (`current`; `behind` is a shop whose migration failed or never ran, which answers 503; `no database`; `unreachable`), whether it has an owner, when the setup code that is waiting runs out, and your note (or the reason it is suspended). It only reads: nothing is written. A closed shop is listed but its database is not looked at.

## Suspend and resume

```
make shop-suspend SLUG=<name> REASON="<why>" [STACK=prod]
make shop-resume SLUG=<name> [STACK=prod]
```

A suspended shop answers every route except `/health` with 403 `shop_suspended`: sign-in, refresh and sync too. Its tablets keep selling offline and sync after a resume, because a sale at the till is never blocked by a billing state. It takes effect within 30 seconds, the time the server keeps what it knows about an address; the same for a resume. The reason is required (up to 500 characters) and goes in `shop_event`. Nothing in the shop's database changes. Doing it twice says "already" and writes nothing.

## The owner signs up

The owner opens the address of the shop in a browser. While the shop has no owner, the login page offers "Create your shop" and the sign-up page asks, in its first step, for the **setup code** next to the name, the email and the password. Case, spaces and dashes do not matter. The owner finishes the four steps and the account, the shop's name and logo, its units and its currency are made together. The code is then used up. A shop that has an owner no longer asks for a code (the page says sign-up is closed), and a server with `OWNER_SIGNUP_ENABLED=false` closes every sign-up, whatever code is typed.

A code that does not open the sign-up gets one answer, the answer of a closed sign-up, whatever is wrong with it (a wrong code, an old one, one that was used or stopped, a code of another shop, or none): nobody can learn from the answer whether a shop waits for its owner or whether a code was ever made. The owner sees "This code did not work. Check it, or ask for a new one" and keeps what was typed. Guessing is limited twice:

- **For each shop**: the code that is waiting takes 10 wrong tries. The tenth stops it for good (the operator makes a new one, which resets the count) and writes `shop.setup_code_locked` to `shop_event`. The count is in the control database, so a restart does not reset it. The right code is not counted.
- **For each client address**: 5 failed tries in 15 minutes, on any shop, block that address for the rest of the window (429, "Too many attempts"), whatever it sends, even the right code. This count is kept in the memory of the API, so a restart clears it. Behind Caddy the address is the real client's (`trust proxy`), not the proxy's.

**If the owner says the code does not work:** run `make shop-list` (it shows when the code that is waiting runs out), and look at the shop's events (query below). A code that ran out, was used (`shop.setup_code_used`) or was locked (`shop.setup_code_locked`) needs a new one: `make shop-code`. If the owner signed up already, the shop has an owner and a code opens nothing; a forgotten password is `make owner`. A suspended shop answers 403 `shop_suspended` before any code is looked at; `make shop-resume` first. If one place sends many owners at once (an office, one phone network), the address limit can block them: wait 15 minutes or restart the `api` container.

**Order of events at the sign-up**: the code is checked without being used, the owner and the settings are made, and the code is marked used in the same request; if marking fails the request fails and the owner is not made. Two people who sign up with the same code at the same moment make one owner and the other gets the closed answer. If the owner was made and the answer was lost on the way (a dropped connection), the code is used and the shop has its owner: the owner signs in with the account they typed.

## A new setup code

```
make shop-code SLUG=<name> [STACK=prod]
```

Only for a shop that is served or suspended and has no owner yet. A shop that has an owner is refused: a code opens nothing there, and a forgotten password is `make owner` (see [the API runbook](api.md)). The code that was waiting stops working, also when it had been locked by wrong tries; only one works at a time. Codes that were used or ran out are left as they are.

**A lost code.** The code is shown once and only its hash is kept, so a lost code cannot be looked up and nothing recovers it. If the owner has not signed up yet, this command is the answer: make a new code and hand it over; the lost one stops working. If you are not sure the owner never signed up, `make shop-list` shows whether the shop has an owner.

## Another address

```
make shop-host SLUG=<name> HOST=<address> [STACK=prod]
```

Adds an address to a shop that is served or suspended, for example a host name for a shop that was adopted by its IP. The old address keeps working. An address of another shop is refused. It serves within 30 seconds. A name under `PLATFORM_DOMAIN` gets its HTTPS certificate when it is first opened (a name anywhere else, no certificate; see "Many shops" in [deploy.md](deploy.md)).

## Close a shop

```
make shop-close SLUG=<name> REASON="<why>" CONFIRM=<name again> [STACK=prod]
```

Closing is final: the shop cannot be resumed. Its addresses stop answering (404, as an unknown address does) within 30 seconds. **Its database and every row stay on the server; nothing is dropped or deleted.** Dropping a database is a separate decision, made by hand after an export (`make export`) and a backup that is checked, and no command does it. The addresses of a closed shop are not released, so none can be given to another shop by mistake while old devices may still use it. A shop that was never finished can be closed too.

## Back up and restore a shop

Every shop and the control database are dumped every night, each into its own folder, and `make backup SHOP=<slug>`, `make restore SHOP=<slug> FILE=…`, `make export SHOP=<slug>` and `make import SHOP=<slug> FILE=…` work on one shop. All of it is in [the backup runbook](backup.md), "Many shops". A restore stops `api` and `web`, so **every** shop is offline while it runs, a few minutes at most; their tablets keep selling offline. Do it when the shops are quiet.

The accounts of a shop are made in the shop's own database: `make owner SHOP=<slug> USERNAME=…`, `make partner-user SHOP=<slug> …` and `make cashier-user SHOP=<slug> …` ([the API runbook](api.md)).

## Move a shop to another server

For a shop that must go to another multi-shop server (a bigger machine, a second server for the shops of another region). Both servers run this version. The commands below were each run separately in the tests of Step 8; the whole move between two servers has not been rehearsed (Step 10 of [the plan](../MULTI_SHOP_PLAN.md) rehearsed the roll-out on one server, [multi-shop-rollout.md](multi-shop-rollout.md), not this move), so do the first one with a shop that can wait.

1. **Old server: stop the writes.** `make shop-suspend SLUG=<slug> REASON="moving to another server" STACK=prod`, then wait 30 seconds (the time the server keeps what it knows about an address). The shop now answers 403 on every route, so nothing can be written; its tablets keep selling offline and sync after the move.
2. **Old server: dump it.** `make backup SHOP=<slug> STACK=prod`, and copy the newest file in `backups/<slug>/` to the new server.
3. **New server: make the shop.** `make shop-new SLUG=<slug> HOST=<address> STACK=prod`. Use the same slug, so the database is `shop_<slug>` there. Its setup code is not needed: the dump holds the owner. (The code stays in the control database and opens nothing once the shop has an owner.)
4. **New server: restore the dump.** `make restore SHOP=<slug> FILE=<the dump> STACK=prod`. The dump is of the database `shop_<slug>` on the old server, which is the database name here, so the check passes. If the shop was **adopted** on the old server, its database there has the old name (for example `fabric_shop`); add `FORCE_DB_MISMATCH=1`, which is what that variable is for. The restore gives the shop a new epoch.
5. **Point the address at the new server.** A name under `PLATFORM_DOMAIN` is covered by the wildcard DNS record, which points at one server: give this name its own `A` record for the new server (an explicit record wins over the wildcard), and open the address once so Caddy makes its certificate. An address on another domain: change its record.
6. **Check.** Sign in as the owner, open a sale, and look at the sync status of a tablet. The users do not sign in again: their refresh cookies work against the restored sessions, and the new access tokens use the key of the shop on the new server (a shop's key comes from `JWT_ACCESS_SECRET` and the shop's id, which is new there). The devices see the new epoch and pull everything again.
7. **Old server: close it.** Only when the shop works on the new server: `make shop-close SLUG=<slug> REASON="moved to <server>" CONFIRM=<slug> STACK=prod`. Its database and dumps stay on the old server until you remove them by hand, after you have a dump of the new server that you have checked.

To go back before step 7: put the DNS record back and `make shop-resume SLUG=<slug>` on the old server. What was written on the new server in between is not on the old one.

## What was done, and by whom

```
docker compose --env-file .env -f infra/docker/compose.prod.yml exec postgres \
  psql -U "$POSTGRES_USER" -d fabric_control \
  -c "SELECT e.created_at, e.actor, s.slug, e.action, e.detail FROM shop_event e LEFT JOIN shop s ON s.id = e.shop_id ORDER BY e.created_at DESC LIMIT 20"
```

The actions are `shop.created`, `shop.host_added`, `shop.setup_code_made`, `shop.activated`, `shop.suspended`, `shop.resumed`, `shop.closed`, (adoption) `shop.adopted`, `shop.restored` (a dump was restored into the shop: the actor and the file are in its detail), and two that the API writes itself (actor `api`): `shop.setup_code_used` when an owner signed up with the code and `shop.setup_code_locked` when wrong tries stopped it. The actor of the others is the login of the person who ran the command. No event holds a setup code, right or wrong.

## Exit codes and messages

Every command exits 0 when it did what was asked or it was done already, 1 when it was refused or failed (the message says why and what to do), and 2 when it was used wrongly (it prints the usage). A refusal that comes before the first write leaves no trace.
