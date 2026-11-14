# Runbook: deploy to a small VPS

The production stack is one server running Docker: Postgres, the API, the web app, Caddy (HTTPS) and a nightly backup service (`infra/docker/compose.prod.yml`). A 2 vCPU / 2 GB VPS is plenty for one shop. These steps assume Ubuntu 24.04 LTS; adapt the package commands for another distribution.

## 1. Before you start

- A domain name, e.g. `shop.example.ma`, with an `A` record (and `AAAA` for IPv6) pointing at the server's IP. Caddy cannot get a certificate until DNS resolves.
- SSH access to the server with a key, as a user who can `sudo`.

## 2. Prepare the server (once)

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git make unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades    # security updates, automatically

# Firewall: SSH, HTTP (certificate challenges and the redirect) and HTTPS only.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp                             # HTTP/3
sudo ufw enable
```

Turn off password logins for SSH: `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then `sudo systemctl reload ssh`.

### Docker

Install Docker Engine and the compose plugin from Docker's own repository ([docs.docker.com/engine/install/ubuntu](https://docs.docker.com/engine/install/ubuntu/)). Then:

```sh
sudo systemctl enable --now docker                 # starts on boot; containers restart with it
```

Rotate container logs, so they cannot fill the disk. In `/etc/docker/daemon.json`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }
```

Then `sudo systemctl restart docker`.

### A user for the shop

Run the stack as a dedicated, non-root user. Membership of the `docker` group is equivalent to root on this machine, so keep that account for the shop only and log in with a key.

```sh
sudo adduser --disabled-password --gecos '' shop
sudo usermod -aG docker shop
sudo mkdir -p /home/shop/.ssh && sudo cp ~/.ssh/authorized_keys /home/shop/.ssh/
sudo chown -R shop:shop /home/shop/.ssh
```

Every following step runs as `shop` (`ssh shop@server`).

## 3. Install the app

```sh
git clone <repository URL> ~/fabric-shop && cd ~/fabric-shop
cp .env.example .env && chmod 600 .env
mkdir -p backups
```

Edit `.env`. Every variable is described in `.env.example`; on the server set at least:

| Variable                    | Value                                                                             |
| --------------------------- | --------------------------------------------------------------------------------- |
| `STACK`                     | `prod`: a plain `make up` and every other `make` target then run production       |
| `POSTGRES_PASSWORD`         | `openssl rand -base64 32`                                                         |
| `JWT_ACCESS_SECRET`         | `openssl rand -base64 48` (the API refuses to start with the example value)       |
| `DOMAIN`                    | `shop.example.ma`                                                                 |
| `ACME_EMAIL`                | an address that receives certificate expiry warnings                              |
| `PLATFORM_DOMAIN`           | only for many shops: the domain the shops' addresses are under (see "Many shops") |
| `IMAGE_TAG`                 | the release you deploy, e.g. `2026-10-30` (see Update)                            |
| `BACKUP_UID` / `BACKUP_GID` | `id -u` / `id -g` of `shop`, who owns `backups/`                                  |
| `BACKUP_AT`                 | the nightly backup time in UTC, when the shop is closed (`02:30`)                 |

The application never reads secrets from its images: they come from this file at run time.

## 4. Start it

```sh
make up STACK=prod                # builds the images, starts everything, waits until healthy
make owner USERNAME=<name> STACK=prod   # the owner's account (asks for the password)
```

**Or create the owner in the browser.** On a server with no owner yet, `https://<DOMAIN>/signup` creates the owner account and sets the shop up (name, logo, selling units, currency) and signs the owner in ([ADR 0023](../adr/0023-owner-self-registration-and-selling-units.md)). It works once: as soon as an owner exists the page shows "Sign-up is closed" and the sign-in page stops linking to it. Because the first visitor becomes the owner, open the page yourself straight after `make up`, before sharing the address. To rule the page out, set `OWNER_SIGNUP_ENABLED=false` in `.env` before `make up` and use `make owner`. The sign-up route is also rate-limited, to 5 attempts a minute per client IP.

Check:

- `https://<DOMAIN>/api/health` answers `{"status":"ok"…}`;
- `https://<DOMAIN>` shows the sign-in page; sign in on the main till and on the phone;
- `make backup STACK=prod` writes a dump into `backups/`;
- the nightly service can write too: `docker compose --env-file .env -f infra/docker/compose.prod.yml run --rm -e BACKUP_ONCE=1 backup`.

Every service has `restart: unless-stopped`: after a crash or a reboot, Docker starts it again.

### Temporary: by IP address, before a domain exists

Set `DOMAIN` to the server's IP address (for example `DOMAIN=76.13.56.213`) and `STACK=prod`, fill in the other values as above (`ACME_EMAIL` can be any address: an IP gets no Let's Encrypt certificate), and run `make up`. Open ports 80 and 443 in the server's firewall and in the hosting provider's panel, then browse to `https://<IP>`.

It has to be HTTPS even on an IP. The app creates every record's id in the browser with `crypto.randomUUID`, and the sign-in cookie is marked Secure; a browser offers the first only on a secure page and drops the second over plain HTTP, so signing in and saving would fail. Caddy serves the IP over HTTPS with a certificate from its own local authority, which no browser knows, so each device shows a certificate warning until it trusts that authority. Verified on a production build of this stack: the page loads, sign-in survives a reload, and the health check answers.

- **Quick use:** accept the warning. Selling and syncing work. The browser refuses to register the service worker for an untrusted certificate, so the app cannot be installed and cannot be reloaded while offline.
- **Proper use on the shop's tablet:** copy Caddy's root certificate out of the server and install it on the tablet as a CA certificate (on Android: Settings → Security → Encryption and credentials → Install a certificate → CA certificate). The warning then disappears, the app can be installed, and it reloads offline.

  ```sh
  docker compose --env-file .env -f infra/docker/compose.prod.yml cp proxy:/data/caddy/pki/authorities/local/root.crt ./caddy-root.crt
  ```

  The matching private key stays in the server's `caddy_data` volume. Install the certificate only on the shop's own devices, and remove it once the shop has a domain.

- **Other ports:** if 80 and 443 are taken, set `HTTP_PORT` and `HTTPS_PORT` and browse to `https://<IP>:<HTTPS_PORT>` directly. The automatic redirect from plain HTTP always points at port 443, so it does not help on other ports.

**Moving to a domain later.** Point the domain at the server, set `DOMAIN` to it, and run `make up`; Caddy then gets a trusted Let's Encrypt certificate. A browser keeps its local database per address, so `https://<domain>` starts with an empty database on each device and downloads everything from the server. Before changing, make sure every device shows "connected" with nothing waiting to sync, because work still waiting on the IP address's copy cannot be reached from the new address.

### Many shops: HTTPS for each shop's address

Only for a server that serves many shops ([ADR 0029](../adr/0029-multi-shop-database-isolation.md), Step 7 of [the plan](../MULTI_SHOP_PLAN.md); making the shops is in [shops.md](shops.md)). **Turning it on, on a live one-shop server, is its own runbook: [multi-shop-rollout.md](multi-shop-rollout.md)** (dump, release with the flag off, adopt, the flag, a test shop, the first neighbour, and the way back from each stage). This section is what the proxy does once it is on. Each shop is served at its own address, `https://<name>.<PLATFORM_DOMAIN>`, and each address gets its own certificate from Let's Encrypt **the first time it is opened**. Making a shop needs no change to `Caddyfile` and no restart.

1. Pick the domain that the shops live under and set `PLATFORM_DOMAIN` in `.env` (for example `PLATFORM_DOMAIN=shops.example.ma`). It can be the same domain as `DOMAIN` or another one.
2. Add **one wildcard DNS record** for it: `*.shops.example.ma`, type `A` (and `AAAA` for IPv6), pointing at the server. Every shop name then resolves to the server with nothing more to do in DNS.
3. `make up STACK=prod`. It recreates the `proxy` service with the new value.

How it works. The `Caddyfile` has a site `*.{$PLATFORM_DOMAIN}` with `tls { on_demand }`. The first time a browser opens a name that has no certificate yet, Caddy does not go to Let's Encrypt at once: it first calls `http://api:4000/internal/known-host?domain=<name>` on the Docker network. The API answers 200 only if the name is the address of a shop that is **not closed** (a shop that is switched off or still being made counts, because its address must still answer), and 404 for everything else, including every IP address. Only a 200 lets Caddy go on, so a name that nobody made a shop for gets no certificate and the TLS handshake fails. The answer is read from the control database each time, so a shop made a second ago can be opened at once. The first visit to a new name takes a few seconds while the certificate is made; later visits do not. The bare-IP address of an existing shop is a separate site with Caddy's own certificate and is not touched.

Limits to know (Let's Encrypt's published ones; the real check with a real DNS record and a phone is stage 4 of [multi-shop-rollout.md](multi-shop-rollout.md), and only the operator can run it):

- **50 new certificates a week for each registered domain** (`example.ma`, whatever the number of subdomains). It is also the most shops that can be opened for the first time in one week. A renewal does not count against it.
- **5 failed validations for each name each hour.** Open a new shop's address once, check DNS first if it fails, and wait before trying again.
- **5 identical certificates a week.** Never run `docker compose down -v` or delete the `caddy_data` volume: it holds the certificates and the Let's Encrypt account, and losing it asks for every shop's certificate again, all at once, which can reach the limits above.
- There is **no wildcard certificate**: it needs a DNS plug-in that the stock Caddy image does not have. Each name has its own.
- A shop at a domain that is not under `PLATFORM_DOMAIN` gets no certificate (the site only takes names under it). That is not built.

**The security rule of this design: the API port is never published and never reachable from outside the Docker network.** Two things depend on it:

- The API takes the shop's address and the client's address from `X-Forwarded-Host` and `X-Forwarded-For`, and trusts them from any private address (`trust proxy`). Only Caddy may be able to send them.
- The `ask` route is called by Caddy straight on the Docker network, so its request has no `X-Forwarded-For`; every request that came through Caddy has one, and the route refuses it. Besides this, the `Caddyfile` answers 404 for `/api/internal/*`. If the API port were open, anybody could call the route without that header and learn which names are shops.

So `compose.prod.yml` has no `ports:` for `api`, `postgres` or `web`, and must never get one. Do not put another proxy or a CDN in front of Caddy without reading this section again: it changes what `X-Forwarded-For` means. Check it after every change of the stack:

```sh
make ps STACK=prod                                   # only proxy shows ports (80, 443)
curl -sS -o /dev/null -w '%{http_code}\n' "http://<server IP>:4000/health"      # from another machine: connection refused
curl -sS -o /dev/null -w '%{http_code}\n' "https://<shop address>/api/internal/known-host?domain=<shop address>"   # 404
```

After the first shop is made (`make shop-new SLUG=test`), check:

- `https://test.<PLATFORM_DOMAIN>/api/health` answers `{"status":"ok"…}` and the browser shows no warning (the certificate is from Let's Encrypt);
- `https://nobody.<PLATFORM_DOMAIN>` (a name that is not a shop) fails with a TLS error (no certificate), and `make logs SERVICE=api STACK=prod` shows a 404 for `/internal/known-host?domain=nobody.<PLATFORM_DOMAIN>` from that moment (Caddy itself logs nothing about a refused name);
- the existing shop at the bare IP address still opens.

Do not change the site `*.{$PLATFORM_DOMAIN}` to a site with no name (`https://`). A site with no name also takes the visits that send no server name, which is every visit to a bare IP address; Caddy then asks the API about the default name and refuses it, and the bare-IP shop stops opening. This was tried and it fails.

## 5. Backups off the server

The nightly service keeps the newest `BACKUP_KEEP` dumps in `backups/`, on the same disk as the database. Copy them somewhere else every day, for example with a cron job on another machine:

```sh
rsync -a --delete shop@server:fabric-shop/backups/ /mnt/shop-backups/
```

Check monthly that a dump restores: `make backup-verify STACK=prod` ([backup.md](backup.md)).

**With many shops** (`MULTI_SHOP=true`) the `backup` service dumps every shop that is not closed into `backups/<slug>/` and the control database into `backups/control/`, at the same `BACKUP_AT`, and keeps the newest `BACKUP_KEEP` files in each folder. It reads the list of shops from the control database, so a shop made at 14:00 is in that night's run. It follows `MULTI_SHOP` and `CONTROL_DATABASE_NAME` from `.env`, which `compose.prod.yml` passes to it. Copy the whole `backups/` folder off the server, `control/` included. Check after turning the flag on, and after every change of the stack: `docker compose --env-file .env -f infra/docker/compose.prod.yml run --rm -e BACKUP_ONCE=1 backup` prints one `backup:` line for each shop and one for the control database, and exits 0. The disk needs the size of every shop's dump, times `BACKUP_KEEP`. One shop that fails to dump does not stop the others; the run ends as a failure and the log says which (`make logs SERVICE=backup STACK=prod`). Look at that log after the first nights.

## 6. Update

```sh
cd ~/fabric-shop
make backup STACK=prod                       # a fresh dump first
git fetch --tags && git checkout <release tag>
# set IMAGE_TAG=<release tag> in .env, so the previous images stay for a rollback
make up STACK=prod
```

`make up` builds the new images and replaces the containers. The API applies pending migrations before it accepts requests. Open devices see a "new version" notice and reload; work they hold is in IndexedDB and syncs as usual.

**The release that adds account management** ([ADR 0024](../adr/0024-account-management.md), migration 0034) links every partner login to a partner. A partner login created earlier with `make partner-user` belongs to no partner, so the migration **switches it off** (its sessions are revoked, each switch is audit-logged) rather than guess whose it was. Cashier and owner accounts are untouched. After updating, make each partner's login again in Settings > Accounts (or `make partner-user USERNAME=<name> PARTNER=<partner> STACK=prod`) and hand over the temporary password. The guard now reads the account on every request, so a token issued before a switch-off stops working at once. Before updating, `make backup STACK=prod` as usual; the migration only adds columns and constraints.

**The release that moves stock to product batches** ([ADR 0012](../adr/0012-product-batches-single-stock-source.md), migrations 0028–0030) copies the rolls, stock moves and sale lines into batches. Before it: `make backup STACK=prod`, then `make backup-verify STACK=prod`. The migrations check their own work and abort, leaving the database as it was, if anything differs; the old tables are kept. Rolling back means restoring the dump (below): the old code cannot read sales made on batches. Each open device upgrades its own database in place on reload, offline too.

## 7. Roll back

If the new release misbehaves:

1. Put the previous `IMAGE_TAG` back in `.env` and check out the previous tag (`git checkout <previous tag>`), so the compose file matches.
2. `make up STACK=prod`. The previous images are still on the server, so nothing is rebuilt.
3. Migrations only go forward. If the new release changed the schema and the old code fails on it, restore the dump taken before the update: `make restore FILE=backups/<that dump> STACK=prod` ([backup.md](backup.md)). Changes made after that dump are lost from the server; devices pull the restored data again (a new epoch) and push what they still have pending.

   **With many shops** the update migrated the control database and every shop, so go back the same way: restore the dump of each shop that the update changed (`make restore SHOP=<slug> FILE=backups/<slug>/<dump> STACK=prod`, each one stops `api` and `web` for a short time) and, if the control database changed, its dump (`SHOP=control`). A shop that was not restored and was migrated is on the new schema: the old code cannot serve it. This is why the update rule is "expand, then contract" ([the API runbook](api.md)).

## 8. Day to day

| Task                       | Command                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is everything up?          | `make ps STACK=prod`                                                                                                                                                                                                                  |
| Logs of one service        | `make logs SERVICE=api STACK=prod`                                                                                                                                                                                                    |
| Restart one service        | `docker compose --env-file .env -f infra/docker/compose.prod.yml restart api`                                                                                                                                                         |
| Disk space                 | `df -h` and `docker system df`                                                                                                                                                                                                        |
| Remove unused images       | `docker image prune` (keep the previous release's images)                                                                                                                                                                             |
| New owner password         | `make owner USERNAME=<name> STACK=prod` (signs everyone out; with many shops add `SHOP=<slug>`, it signs out that shop only)                                                                                                          |
| Change `JWT_ACCESS_SECRET` | edit `.env`, `make up STACK=prod`. With many shops it stops the access tokens of **every shop** at once: devices refresh with their cookies and nobody signs in again, but do it when the shops are quiet ([the API runbook](api.md)) |
