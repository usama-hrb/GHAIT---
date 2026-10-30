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

Check:

- `https://<DOMAIN>/api/health` answers `{"status":"ok"…}`;
- `https://<DOMAIN>` shows the sign-in page; sign in on the main till and on the phone;
- `make backup STACK=prod` writes a dump into `backups/`;
- the nightly service can write too: `docker compose --env-file .env -f infra/docker/compose.prod.yml run --rm -e BACKUP_ONCE=1 backup`.

Every service has `restart: unless-stopped`: after a crash or a reboot, Docker starts it again.

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
