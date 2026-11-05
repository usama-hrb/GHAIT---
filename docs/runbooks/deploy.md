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

| Variable                    | Value                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| `STACK`                     | `prod`: a plain `make up` and every other `make` target then run production |
| `POSTGRES_PASSWORD`         | `openssl rand -base64 32`                                                   |
| `JWT_ACCESS_SECRET`         | `openssl rand -base64 48` (the API refuses to start with the example value) |
| `DOMAIN`                    | `shop.example.ma`                                                           |
| `ACME_EMAIL`                | an address that receives certificate expiry warnings                        |
| `IMAGE_TAG`                 | the release you deploy, e.g. `2026-10-30` (see Update)                      |
| `BACKUP_UID` / `BACKUP_GID` | `id -u` / `id -g` of `shop`, who owns `backups/`                            |
| `BACKUP_AT`                 | the nightly backup time in UTC, when the shop is closed (`02:30`)           |

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

## 5. Backups off the server

The nightly service keeps the newest `BACKUP_KEEP` dumps in `backups/`, on the same disk as the database. Copy them somewhere else every day, for example with a cron job on another machine:

```sh
rsync -a --delete shop@server:fabric-shop/backups/ /mnt/shop-backups/
```

Check monthly that a dump restores: `make backup-verify STACK=prod` ([backup.md](backup.md)).

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

## 8. Day to day

| Task                 | Command                                                                       |
| -------------------- | ----------------------------------------------------------------------------- |
| Is everything up?    | `make ps STACK=prod`                                                          |
| Logs of one service  | `make logs SERVICE=api STACK=prod`                                            |
| Restart one service  | `docker compose --env-file .env -f infra/docker/compose.prod.yml restart api` |
| Disk space           | `df -h` and `docker system df`                                                |
| Remove unused images | `docker image prune` (keep the previous release's images)                     |
| New owner password   | `make owner USERNAME=<name> STACK=prod` (signs everyone out)                  |
