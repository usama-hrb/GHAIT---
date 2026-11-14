# Runbook: database backup and restore

The shop's data lives on the devices (offline-first) and on the server's Postgres. The server copy is what we back up. These steps work for both stacks; add `STACK=prod` on the server (default is `STACK=dev`).

Scripts: [infra/scripts/](../../infra/scripts/) (`backup.sh`, `restore.sh`, `verify-backup.sh`). They run `pg_dump`/`pg_restore` inside the Postgres container, so the host needs only Docker and bash.

## What a backup is

- One file per run: `backups/<db>_<UTC timestamp>.dump`, e.g. `backups/fabric_shop_20261029T153622Z.dump`.
- `pg_dump` custom format, compressed (`--compress=9`), without owners or grants, so it restores into any database.
- Checked right after it is written: if `pg_restore` cannot read it, it is deleted and the command fails.
- Rotation: only the newest `BACKUP_KEEP` dumps (default 14) are kept; older ones are deleted.

Settings in `.env`: `BACKUP_DIR` (default `./backups`, git-ignored) and `BACKUP_KEEP` (default 14).

A server that serves many shops (`MULTI_SHOP=true`) keeps one folder for each shop and one for the control database. That is [its own section](#many-shops-multi_shoptrue) below; read it after this page's one-shop parts, which it builds on.

## Nightly backups (prod)

The prod stack's `backup` service (`infra/docker/backup/nightly.sh`) takes the same dump every day at `BACKUP_AT` (UTC, default 02:30) into `<repo>/backups`, with the same rotation. It runs as `BACKUP_UID:BACKUP_GID` (the owner of that directory), with a read-only filesystem and no capabilities. Copy `backups/` off the server every day ([deploy.md](deploy.md) §5).

To check it can write: `docker compose --env-file .env -f infra/docker/compose.prod.yml run --rm -e BACKUP_ONCE=1 backup`.

With many shops the same service reads the list of shops from the control database and dumps each of them, then the control database ([below](#many-shops-multi_shoptrue)). It needs no setting of its own: it follows `MULTI_SHOP` and `CONTROL_DATABASE_NAME` from `.env`.

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
3. It records a new epoch (`server_instance`). On their next sync, devices see it and pull everything again from the start: their sync cursors pointed past the restored data. Changes a device had not pushed yet are still in its outbox and are pushed as usual.
4. Everything written to the server after that dump is lost from the server. A device may still show some of it (records it had pulled that the server no longer has): after a restore, check the last day's sales and payments on each device against the server, and enter again what is missing.

## Export and import (JSON)

A second kind of copy, independent of Postgres: every record the devices sync, in one JSON file (`@fabric/contracts` `dataExportSchema`). It is also what rebuilds the server when the server **and** its dumps are lost, because every device holds the whole shop.

- From the server: `make export STACK=prod` writes `backups/export_<UTC time>.json` (or `FILE=…`).
- From a device: Settings → "نسخة من البيانات" → "تنزيل نسخة كاملة (JSON)". It works offline. "تنزيل جدول (CSV)" gives one table for a spreadsheet.

To rebuild a server from an export:

1. Start the stack on an empty database (a new server, or `make down`, remove the `pg_data` volume, `make up`). The API applies the migrations.
2. `make import FILE=<export.json> STACK=prod`. It refuses a database that already has shop data, and inserts everything in one transaction: all or nothing. Device codes come from the export (a server export), or from the roll codes (a device export), so new devices never reuse a code.
3. `make owner USERNAME=<name> STACK=prod`: accounts and sessions are not in the export.
4. Devices see the new epoch and pull everything again. Use the export of the device that synced last: a device export holds what that device had pulled, plus its own changes.

Before replacing production data, take a backup of the current state first (`make backup STACK=prod`), even if it is broken. That backup is your way back.

## Many shops (`MULTI_SHOP=true`)

[ADR 0029](../adr/0029-multi-shop-database-isolation.md), Step 8 of [the plan](../MULTI_SHOP_PLAN.md). Every shop has its own database, so every shop has its own dumps, and the control database (the list of shops, their addresses, their setup codes and what the operator did) has its own too. Everything above holds for one database; this section says what changes. On a one-shop server nothing changes, and `SHOP` is refused there.

### Layout

```
backups/<slug>/<database>_<UTC timestamp>.dump        every shop that is not closed (a suspended one too)
backups/control/<control database>_<UTC timestamp>.dump
```

For example `backups/alpha/shop_alpha_20261113T023001Z.dump` and `backups/control/fabric_control_20261113T023004Z.dump`. A shop adopted from a one-shop server keeps its old database name (`backups/<slug>/fabric_shop_….dump`). Dumps that were made before the flag was turned on stay in `backups/` where they are; nothing touches them any more (rotation does not count them either), so they are not deleted for you: keep the last one as the way back for the first week ([multi-shop-rollout.md](multi-shop-rollout.md)), then delete them by hand.

- **A suspended shop is backed up.** Suspending switches the shop off; its data is still there.
- **A closed shop is not dumped.** Its folder keeps its last dumps until you remove them by hand.
- **A shop that is still being made and has no database yet** is skipped (the run says so) and is not a failure.
- **Rotation works on one folder at a time.** It keeps the newest `BACKUP_KEEP` files of that folder named exactly `<database>_<YYYYMMDD>T<HHMMSS>Z.dump`. It never removes a file of another shop, a file you put in a folder by hand, or a dump of a database with a similar name (`shop_alpha_two_….dump` is not a dump of `shop_alpha`). Pruning one shop never touches another shop's folder.
- **One failure does not stop the others.** If a shop cannot be dumped (its database is gone, the disk is full), the run says which, dumps the other shops and the control database anyway, and ends as a failure: `make backup` exits 1, the nightly service logs `backup FAILED for <database>`. If the list of shops cannot be read from the control database, no shop is dumped, the control database is still tried, and the run fails.

### Commands

```sh
make backup STACK=prod                  # every shop, then the control database
make backup SHOP=alpha STACK=prod       # one shop
make backup SHOP=control STACK=prod     # the control database
make backup-verify STACK=prod           # a fresh dump of each, restored into a scratch database and counted
make backup-verify SHOP=alpha STACK=prod
```

`backup-verify` restores each dump into `<database>_restore_check`, compares the row count of every table with the live database, and drops the scratch copy; with several databases it prints one line for each, and it exits 1 if any differs. Run it at least monthly on the server.

### Restore one shop

```sh
make restore SHOP=alpha FILE=backups/alpha/shop_alpha_20261113T023001Z.dump STACK=prod
```

1. It reads the database name stored in the dump and refuses a dump of any other database: the file of shop B can never be restored into shop A by a wrong path. `FORCE_DB_MISMATCH=1` lifts this, only for moving a shop whose database has another name (see "Move a shop to another server" in [shops.md](shops.md)).
2. It names the database it will replace and asks you to type the shop's name (`CONFIRM=<slug>` for a script). A closed shop is refused; restore its dump into a scratch database instead (`make restore FILE=… DB=<scratch>`, no `SHOP`).
3. **It stops `api` and `web`, so every shop on the server is offline until it ends.** The time is that of the restore of one database: seconds for a small shop (a database of 382 MB took 5 seconds in the measurement of A6). The tablets of every shop keep selling offline and sync when the server is back. `api` and `web` are started again at the end, also when the restore fails.
4. It restores in one transaction (all or nothing), then gives **that shop** a new epoch (`server_instance`): its devices pull everything again from the start, the devices of the other shops notice nothing.
5. It writes `shop.restored` to the control database's `shop_event` (who, and which file), not to the shop's own `audit_log`, which the restore has just replaced.

The other shops are not touched: restoring yesterday's dump of shop A left the row counts of the other shops as they were (checked on a scratch stack with four shops, see Step 8 of the plan). As for one shop, everything written to that shop after the dump is lost from the server; a device may still show it, so check the last day's sales and payments on each device.

### Restore the control database

```sh
make restore SHOP=control FILE=backups/control/fabric_control_20261113T023004Z.dump STACK=prod
```

It replaces the list of shops, their addresses, their setup codes and the events with what the dump held. The shops' own databases are not touched. Afterwards, every change made since that dump has to be done again: a shop made, suspended, resumed, closed, or given an address after it. A shop made after the dump still has its database but is not in the list, so its address answers 404, and `make shop-new` for the same name refuses (it does not take over a database it did not make): use another name, or move that database away. This restore writes no `shop_event` (it would be written into the database that was just replaced); keep a note of when you did it.

### Export and import

`make export SHOP=alpha STACK=prod` writes `backups/alpha/export_<UTC time>.json` (or `FILE=…`). `make import SHOP=<slug> FILE=<export.json> STACK=prod` loads an export into that shop, which must have an empty database (the command refuses one that has shop data); then `make owner SHOP=<slug> USERNAME=<name> STACK=prod`. Both refuse to run without `SHOP` on a many-shop server, and refuse a closed or unknown shop.

### How long it takes

Measured on a developer machine (A6 of ADR 0029): 30 shops with an empty schema and the control database took 5.3 seconds in all, 0.17 seconds for each database, and each dump was 328 KB. A shop of 382 MB (500,000 audit rows, which compress badly) dumped in 7.5 seconds into a 119 MB file and restored in 5.4 seconds. A server with 2 vCPU is slower than that machine; do the measurement again on yours before you rely on the number (`time make backup STACK=prod`). Disk: the dumps of all shops, times `BACKUP_KEEP`, must fit next to the database.

## Schedule (server)

Until the nightly backup container arrives (BUILD_PROMPTS 3.6), use the server's crontab. Example: 02:30 every night, as the user that owns the checkout:

```cron
30 2 * * * cd /srv/fabric-shop && make backup STACK=prod >> backups/backup.log 2>&1
```

## Off-site copies

A backup on the same disk as the database does not survive a dead disk or a lost server. Copy `backups/` off the machine at least daily, e.g. `rclone sync backups/ remote:fabric-shop-backups` or `rsync` to another host. Encrypt it if the destination is a third-party service: the dumps contain all customer and financial data. With many shops, copy the whole `backups/` folder, `control/` included: a shop's folder alone does not say its address or its setup code.

## Troubleshooting

| Symptom                                       | Cause / fix                                                                                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `postgres is not running in the 'prod' stack` | Start it: `make up STACK=prod`.                                                                                                                                        |
| `.env not found`                              | Copy `.env.example` to `.env` and fill it in.                                                                                                                          |
| `not a readable pg_dump archive`              | The file is truncated or not a dump. Use an older one.                                                                                                                 |
| `MISMATCH` in `backup-verify`                 | Writes happened during the check. Re-run when quiet; if it persists, the dump is incomplete. Investigate before relying on it.                                         |
| Restore fails midway                          | Nothing was applied (single transaction). Read the first error; usually a dump from an incompatible Postgres major version.                                            |
| `unsupported version (1.16) in file header`   | The dump was made with a newer `pg_dump` than the server's (for example one run on the host). Dump with the scripts: they use the tools inside the Postgres container. |
| `is a dump of the database 'X', not of 'Y'`   | The file is another shop's dump. Take the right file; `FORCE_DB_MISMATCH=1` only for a move.                                                                           |
| `this server has many shops: name one`        | Add `SHOP=<slug>` (`SHOP=control` for the control database); `make shop-list` shows the slugs.                                                                         |
