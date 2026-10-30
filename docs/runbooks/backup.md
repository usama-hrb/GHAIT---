# Runbook: database backup and restore

The shop's data lives on the devices (offline-first) and on the server's Postgres. The server copy is what we back up. These steps work for both stacks; add `STACK=prod` on the server (default is `STACK=dev`).

Scripts: [infra/scripts/](../../infra/scripts/) (`backup.sh`, `restore.sh`, `verify-backup.sh`). They run `pg_dump`/`pg_restore` inside the Postgres container, so the host needs only Docker and bash.

## What a backup is

- One file per run: `backups/<db>_<UTC timestamp>.dump`, e.g. `backups/fabric_shop_20261029T153622Z.dump`.
- `pg_dump` custom format, compressed (`--compress=9`), without owners or grants, so it restores into any database.
- Checked right after it is written: if `pg_restore` cannot read it, it is deleted and the command fails.
- Rotation: only the newest `BACKUP_KEEP` dumps (default 14) are kept; older ones are deleted.

Settings in `.env`: `BACKUP_DIR` (default `./backups`, git-ignored) and `BACKUP_KEEP` (default 14).

## Take a backup

```sh
make backup              # dev stack
make backup STACK=prod   # on the server
```

The stack must be running (`make up`). Output: the file path and its size, and how many old dumps rotation removed.

## Check that backups restore

Run this after any change to the schema or the scripts, before each release, and at least monthly on the server:

```sh
make backup-verify STACK=prod
```

It takes a fresh dump, restores it into a scratch database `<db>_restore_check`, compares the row count of every table with the live database, then drops the scratch database. `OK` means the dump is restorable and complete. `MISMATCH` lists the tables that differ. If the shop was writing during the check, run it again when it is quiet.

To keep the scratch copy for inspection: `KEEP_SCRATCH=1 make backup-verify`.

## Restore

### Into a separate database (safe, nothing live changes)

```sh
make restore FILE=backups/fabric_shop_20261029T153622Z.dump DB=inspect_copy
```

Drops and recreates `inspect_copy`, then restores into it. Use it to look at old data or to recover a few rows by hand. Drop it when done:

```sh
docker compose --env-file .env -f infra/docker/compose.dev.yml exec postgres dropdb -U fabric inspect_copy
```

### Replace the application database (destructive)

```sh
make restore FILE=backups/fabric_shop_20261029T153622Z.dump STACK=prod
```

1. The script asks you to type the database name. Anything else aborts with nothing changed. For scripted use, pass `CONFIRM=<db name>`.
2. It stops `api` and `web`, restores in a single transaction (all or nothing), then starts them again.
3. Everything written to the server after that dump is lost from the server. Devices may still hold some of it locally; how they re-sync with a restored server is designed with the sync engine (ADR 0002, BUILD_PROMPTS 3.1/3.6). Until then, check each device by hand after a production restore.

Before replacing production data, take a backup of the current state first (`make backup STACK=prod`), even if it is broken. That backup is your way back.

## Schedule (server)

Until the nightly backup container arrives (BUILD_PROMPTS 3.6), use the server's crontab. Example: 02:30 every night, as the user that owns the checkout:

```cron
30 2 * * * cd /srv/fabric-shop && make backup STACK=prod >> backups/backup.log 2>&1
```

## Off-site copies

A backup on the same disk as the database does not survive a dead disk or a lost server. Copy `backups/` off the machine at least daily, e.g. `rclone sync backups/ remote:fabric-shop-backups` or `rsync` to another host. Encrypt it if the destination is a third-party service: the dumps contain all customer and financial data.

## Troubleshooting

| Symptom                                       | Cause / fix                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `postgres is not running in the 'prod' stack` | Start it: `make up STACK=prod`.                                                                                                |
| `.env not found`                              | Copy `.env.example` to `.env` and fill it in.                                                                                  |
| `not a readable pg_dump archive`              | The file is truncated or not a dump. Use an older one.                                                                         |
| `MISMATCH` in `backup-verify`                 | Writes happened during the check. Re-run when quiet; if it persists, the dump is incomplete. Investigate before relying on it. |
| Restore fails midway                          | Nothing was applied (single transaction). Read the first error; usually a dump from an incompatible Postgres major version.    |
