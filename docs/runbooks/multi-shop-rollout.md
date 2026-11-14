# Runbook: turn on many shops on the live server

For the person who runs the server (the operator), once, on the server that serves the shop today ([ADR 0029](../adr/0029-multi-shop-database-isolation.md), Step 10 of [the plan](../MULTI_SHOP_PLAN.md)). It takes a live one-shop server to a server with many shops, one stage at a time. Each stage ends with a check and has its own way back, and nothing in a later stage is needed to stay safe in an earlier one: stop after any stage and the shop keeps selling.

The whole sequence was rehearsed on a copy of the production stack (`compose.prod.yml`, the previous release first, then this one, then a rollback and a roll forward), and the commands and the numbers below are what that run did. What a rehearsal cannot show is marked **only on the real server**: the DNS record, the certificates from Let's Encrypt, the tablets and the people. Do those with the owner at the till.

## What you need before you start

- The release you are rolling out is checked out and its images build (`make up STACK=prod` is the normal update, see [deploy.md](deploy.md), section "Update").
- **The address the devices use today**, exactly as they type it: the server's IP (for example `76.13.56.213`) or a domain (`shop.example.ma`). It is what you give `make shop-adopt` in stage 3. Case and a port do not matter.
- A domain for the neighbours' shops, `PLATFORM_DOMAIN` (for example `shops.example.ma`), and a **wildcard DNS record** `*.shops.example.ma` (type `A`, and `AAAA` for IPv6) that points at the server. It can be made now: it changes nothing until stage 3. Check it from your own machine, with any name: `dig +short anything.shops.example.ma` must print the server's IP.
- Ports 80 and 443 (TCP) and 443 (UDP) open to the world, as in [deploy.md](deploy.md). Let's Encrypt checks a new name through them the first time it is opened.
- A key for the setup codes: `openssl rand -base64 48`. Keep it with the other secrets; it is not needed to be safe in stages 1 and 2.
- Room on the disk for one dump of the shop, and later one for each shop, times `BACKUP_KEEP`.
- A time when the shop is closed or quiet, for stage 3. The tablets keep selling offline, so a short stop costs nothing, but there is no reason to do it at the busiest hour.

## Stage 1: a dump, and a copy of it away from the server

```sh
cd ~/fabric-shop
make backup STACK=prod
make backup-verify STACK=prod
```

`backup-verify` restores a fresh dump into a scratch database and compares the rows of every table; it must print `verify: OK`. Then copy the newest file of `backups/` to another machine (`rsync` or `scp`). This is the dump that every rollback below can go back to. Keep it until the flag has been on for a week.

## Stage 2: put this release on the server, flag off

Follow "Update" in [deploy.md](deploy.md): check out the release, put its tag in `IMAGE_TAG` in `.env`, `make up STACK=prod`. Leave `MULTI_SHOP=false`. In this stage the server is the one-shop server it was: the same database, the same sign-in, the same tokens.

Check, with the till and a phone:

- `https://<address>/api/health` answers `{"status":"ok"…}`;
- both devices are signed in, the header says connected with nothing waiting, and a test sale syncs;
- nothing in `make logs SERVICE=api STACK=prod` beyond what the previous release logged.

The previous release's images stay on the server (the earlier `IMAGE_TAG`), so going back is [deploy.md](deploy.md), section "Roll back". The shop's own migrations are byte for byte the same in this release as in the one before it (checked), so nothing in the shop's database changes in this stage or in the next. You can stop here for a day or a week.

## Stage 3: adopt the shop, turn the flag on

Adopting reads the live database and writes the control database `fabric_control` (it is made if it is missing). It works while the flag is off, so do it first and look at it:

```sh
make shop-adopt SLUG=main HOST=<the address the devices use today> STACK=prod
make shop-list STACK=prod
```

`shop-list` must show one line: the shop `main`, state `active`, the address you gave, schema `current`, owner `yes`. If the address is not exactly the one the devices use, fix it **now**, with `make shop-host SLUG=main HOST=<address>`; with the flag on, a request for an address that no shop has gets 404 `No shop is served at this address`. Choose the slug well: it is the name typed in `SHOP=main` for every later command.

Now set the three variables in `.env`, and nothing else:

```
MULTI_SHOP=true
SETUP_CODE_SECRET=<the key made above>
PLATFORM_DOMAIN=<shops.example.ma>
```

and restart once:

```sh
make up STACK=prod
```

The API is down for about 15 to 20 seconds (17 in the rehearsal, until the API is healthy again), and during that time a tablet that is selling just keeps selling offline. The API migrates the control database and the shop's database at start (nothing to change in the shop's: it is already current).

Check, in this order:

1. `https://<address>/api/health` answers ok.
2. Every device of the shop signs in again **by itself**. This is what happens, and it is expected: the access token each device holds was made without the shop in it, so its next request gets one 401, the app asks for a new token with its refresh cookie, and the new token carries the shop. Nobody types a password. A device that stays on the sign-in page, or shows "signed out", is the one to look at: sign in on it once.
3. Make a sale on the till, with the Wi-Fi off, then on: it syncs and the other device sees it.
4. `make shop-list STACK=prod` still shows the shop `active` and `current`.
5. The nightly backup works for every shop and for the control database: `docker compose --env-file .env -f infra/docker/compose.prod.yml run --rm -e BACKUP_ONCE=1 backup` prints one `backup:` line for `main/`, one for `control/` and exits 0. From now on the dumps are in `backups/main/` and `backups/control/`. **The older dumps in `backups/` itself (before the flag) are not rotated any more**: they stay until you remove them by hand. Keep the stage 1 dump as long as you may need to go back to it.
6. Safety of the doors (once; the result is the same on every server): from another machine `curl -sS -m 5 http://<server IP>:4000/health` must fail to connect, and `https://<address>/api/internal/known-host?domain=<address>` must answer 404. If either differs, stop and turn the flag off (the way back below): the port of the API must never be reachable from outside ([deploy.md](deploy.md), "Many shops").

If anything in 1 to 4 is wrong and is not clear in a few minutes: **turn the flag off** (stage 3 in "Ways back"). The shop is then exactly as it was after stage 2.

## Stage 4: a first test shop, on the real certificate. Only on the real server.

This is the only check that a rehearsal cannot do: that a name under `PLATFORM_DOMAIN` gets a certificate from Let's Encrypt, with the real DNS.

```sh
make shop-new SLUG=test LABEL="first check" STACK=prod
```

It prints the setup code once. Then, from a phone that has not seen the name before:

1. Open `https://test.<PLATFORM_DOMAIN>`. It takes a few seconds the first time (the certificate is made then). There must be no warning. If the page does not open, `make logs SERVICE=proxy STACK=prod` says why; the usual causes are the DNS record (not yet there, or not yet everywhere), a closed port 80, or a limit of Let's Encrypt (below). A failed attempt may be repeated, but 5 failures for one name in an hour stops it for an hour.
2. The page offers "Create your shop". Sign up with the setup code, make the owner, finish the four steps, and make one sale with the Wi-Fi off, then on.
3. A name that is not a shop must fail: `https://nobody.<PLATFORM_DOMAIN>` gives a TLS error, not a page.
4. Open the main shop's address once more: it still works, and its figures are the ones it had.
5. `make shop-suspend SLUG=test REASON="check done" STACK=prod`, wait 30 seconds, and the test shop answers 403; `make shop-resume SLUG=test` serves it again. When you do not need the shop any more: `make shop-close SLUG=test REASON="first check" CONFIRM=test STACK=prod`. Closing keeps the database and its rows; the name `test` stays taken.

Let's Encrypt's limits are in [deploy.md](deploy.md), "Many shops": 50 new certificates a week for each registered domain (it is also the most shops that can be opened for the first time in a week), 5 failed validations an hour for each name, and 5 identical certificates a week. Never run `docker compose down -v` or remove the `caddy_data` volume: it holds every shop's certificate.

## Stage 5: the first neighbour. With the owner.

```sh
make shop-new SLUG=<their name> LABEL="<who>" STACK=prod
```

Give them the address (`https://<name>.<PLATFORM_DOMAIN>`) and the setup code, sit with them at the sign-up, install the app on their phone and tablet, and make one sale with the Wi-Fi off, then on. Open the address yourself once before you hand it over. Keep the setup code out of messages that other people can read: it is shown once and works once, for 7 days (a lost one is `make shop-code`, see [shops.md](shops.md)). Then the second neighbour.

After the first week of neighbours: read `make logs SERVICE=backup STACK=prod` (one `backup:` line for every shop, every night), look at the connections of PostgreSQL (`SELECT count(*) FROM pg_stat_activity`: about 100 are available; see [api.md](api.md) for how many shops that is), and run `make backup-verify STACK=prod`.

## Ways back

Each is for the stage it names. Do the first that applies. The first four were run in the rehearsal; the last is the restore procedure of [deploy.md](deploy.md) and was not run for this rollout, because this release changes no shop's schema.

**After stage 2 (flag off, new release).** [deploy.md](deploy.md), "Roll back": the previous `IMAGE_TAG`, the previous checkout, `make up STACK=prod`. The shop's database is the same in both releases, so no restore is needed.

**After stage 3, with the main shop only.** Set `MULTI_SHOP=false` in `.env` and `make up STACK=prod`. `fabric_control` stays on the server and is not read. The access tokens made while the flag was on stop working (each is signed with the shop's own key, which the server with the flag off does not use), so each device gets one 401, renews its token with its refresh cookie, and nobody signs in again. The shop's records are the ones it had. Or put the previous release back (as above): the same happens.

**After neighbours exist.** The order matters. With the flag off the server does not read the address: it serves the main shop at every name that still reaches it. A neighbour's address that already has a certificate would then open the main shop's sign-in page (checked in the rehearsal). Nobody gets into the main shop by that, because the sign-in still needs a user of the main shop, but a neighbour's tablet would fail to sign in and its owner would see the wrong shop. So close their addresses at the proxy first, then turn the flag off:

1. Empty `PLATFORM_DOMAIN` in `.env` and `make up STACK=prod`. Every neighbour's address now fails with a TLS error (checked: `curl: (35) TLS connect error`), and the main shop's address still works. Check one neighbour's address before going on.
2. `MULTI_SHOP=false`, `make up STACK=prod`.

Nothing is lost: each neighbour is a whole database (`shop_<slug>`) and keeps its dumps in `backups/<slug>/`; it stays unreachable until you roll forward. Their tablets keep selling offline and sync later.

**Roll forward again after any of these.** Set `MULTI_SHOP=true` and `PLATFORM_DOMAIN`, `make up STACK=prod`. The control database still has every shop, so the main shop and the neighbours come back as they were (checked: the same rows in both). Devices renew their tokens once.

**After a migration that the old code cannot read** (a later release): restore each shop from the dump taken just before the update, as in [deploy.md](deploy.md), "Roll back", "With many shops". What was written after the dump is lost on the server; the tablets push what they still hold.

## If something does not look like this

| What you see                                                                                     | What it means                                                                                                  | What to do                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| After the flag, the main address gives 404 `No shop is served at this address`                   | The address adopted is not the one the devices use.                                                            | Flag off. `make shop-host SLUG=main HOST=<address>`, then the flag on again.                                                      |
| After the flag, the API does not start; the log says `SETUP_CODE_SECRET`                         | The key is missing or shorter than 32 characters.                                                              | Fix `.env`, `make up STACK=prod`. Until then the shop is down: if it cannot be fixed in a minute, flag off.                       |
| After the flag, the API does not start and the log says it cannot reach or make `fabric_control` | The login of `DATABASE_URL` cannot create databases (not seen in the rehearsal: the Docker stack's login can). | Use the Docker stack's own login (the default), or make the database `fabric_control` by hand once, then `make up STACK=prod`.    |
| A device shows the sign-in page after the flag                                                   | Its refresh cookie is gone (a browser that cleared its data).                                                  | Sign in on it once. Its unsent sales are still on the device.                                                                     |
| A neighbour's page loads but the TLS name is the main shop's certificate                         | The name is not under `PLATFORM_DOMAIN`.                                                                       | The shop's address must be `<name>.<PLATFORM_DOMAIN>`; another domain gets no certificate ([deploy.md](deploy.md), "Many shops"). |
| `make shop-new` says `SETUP_CODE_SECRET` is not set                                              | The `api` container started before `.env` had the key.                                                         | `make up STACK=prod` again.                                                                                                       |
| `too many clients already` in the API log, and some requests answer 500                          | More shops in use at once than PostgreSQL has connections.                                                     | Raise `max_connections` or lower `SHOP_POOL_MAX` ([api.md](api.md)); see the measurement in the ADR, Step 8.                      |

## Done when

Stage 3 checks pass on the real server and the main shop has sold for a day on it; stage 4 passes with a real certificate on a phone; the first neighbour has signed up and has made a sale with the Wi-Fi off. The list in [MVP_ACCEPTANCE.md](../MVP_ACCEPTANCE.md), "A server with many shops", is the final check before a neighbour goes live.
