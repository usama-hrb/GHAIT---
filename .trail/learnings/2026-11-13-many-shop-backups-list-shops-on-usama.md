---
title: "Many-shop backups: list shops on fd 3, prune exact names, check the dump's database"
author: Usama
date: 2026-11-13
branch: main
cost: { minutes: 35, tokens: 506892 }
id: l-a0f9e72b
scope: repo
status: active
src: agent
touches:
  - docs/MULTI_SHOP_PLAN.md
  - apps/api/src/shop-scope.ts
  - apps/api/src/data-export.ts
  - apps/api/src/data-import.ts
  - apps/api/src/shop-scope.spec.ts
  - apps/api/test/shop-scope.e2e-spec.ts
  - infra/docker/backup/nightly.sh
  - Makefile
  - '.env.example'
  - infra/scripts/backup.sh
---

## Decided

- Loop over the shops with the list on file descriptor 3 (`while read … <&3`, `3<<<"$targets"`). `docker compose exec` inside the loop reads standard input and ate the rest of the list: the first run of the many-shop backup dumped one shop and said nothing about the others.
- Prune each shop's folder alone, and match only the exact name `<database>_????????T??????Z.dump`, sorted by name. A loose pattern `<database>_*.dump` lets the rotation of `shop_alpha` delete the dumps of `shop_alpha_two`, and sorting by file time breaks when a folder is copied.
- A restore into a shop reads the `; dbname:` line from `pg_restore --list` and refuses a dump of another database. The file of shop B typed in a hurry would otherwise replace shop A's data. `FORCE_DB_MISMATCH=1` is only for moving a shop whose database has another name (an adopted shop).
- `shop.restored` is written to the control database's `shop_event`, not to the shop's `audit_log`, because the restore replaces that log. A restore of the control database writes no event for the same reason.

## Tried and ruled out

- Pruning by modification time and with one `ls` over all folders: both mix shops or break on a copied folder.
- Dumping with the host's `pg_dump` (18) for the tests of the restore: the server's `pg_restore` 16 refuses it with `unsupported version (1.16) in file header`. Always dump and restore with the tools inside the Postgres container.

## Watch out

- `docker compose exec` in any shell loop that reads from stdin eats the loop's input. Use `-T` and read the loop's list from another descriptor.
- `nightly.sh` has a `BACKUP_ROOT` setting (default `/backups`) only so the test can write to a temporary folder; do not use it in compose.

In the code: `infra/scripts/backup.sh`, `infra/scripts/verify-backup.sh`, `infra/scripts/lib.sh` (`dump_database`, `backup_targets`), `infra/scripts/restore.sh`, `infra/docker/backup/nightly.sh`, `apps/api/test/nightly-backup.e2e-spec.ts`.
