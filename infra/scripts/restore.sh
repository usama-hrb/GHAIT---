#!/usr/bin/env bash
# Restore a dump made by backup.sh.
#
# Usage: STACK=dev|prod infra/scripts/restore.sh <dump-file> [target-db]
#        MULTI_SHOP=true: SHOP=<slug>|control infra/scripts/restore.sh <dump-file>
#
# - target-db omitted: replaces the application database (one-shop server), or the database of the
#   shop named by SHOP, or the control database (SHOP=control). Asks you to type its name first
#   (CONFIRM=<name> skips the prompt) and stops api/web during the restore. With many shops that is
#   every shop: they are offline until the restore ends (their tablets keep selling offline).
# - target-db given: (re)creates that database and restores into it, e.g. a scratch copy
#   to inspect or verify a backup. No shop and no application database is touched.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

file="${1:-}"
[[ -n "$file" ]] || die "usage: restore.sh <dump-file> [target-db]   (many shops: SHOP=<slug> restore.sh <dump-file>)"
[[ -f "$file" ]] || die "dump not found: $file"

require_postgres
shop="${SHOP:-}"
replace=0 # 1: the dump replaces a database that is in use
if multi_shop; then
  if [[ -n "${2:-}" ]]; then
    [[ -z "$shop" ]] || die "give SHOP=<slug> or a target database, not both"
    target="$2"
  else
    [[ -n "$shop" ]] || die "this server has many shops: name the one to restore with SHOP=<slug> (SHOP=control for the control database), or give a scratch database as the second argument"
    if [[ "$shop" == control ]]; then
      target="$(control_db)"
    else
      rows="$(shop_rows "$shop")"
      [[ -n "$rows" ]] || die "there is no open shop '$shop' (make shop-list); a closed shop can be restored into a scratch database"
      read -r _ target _ <<<"$rows"
    fi
    replace=1
  fi
  confirm_name="$shop"
else
  [[ -z "$shop" ]] || die "SHOP is only for MULTI_SHOP=true: this server has one shop"
  db="$(app_db)"
  target="${2:-$db}"
  [[ "$target" == "$db" ]] && replace=1
  confirm_name="$db"
fi
[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || die "invalid database name: $target"
pg pg_restore --list <"$file" >/dev/null || die "not a readable pg_dump archive: $file"

if ((replace)); then
  if multi_shop; then
    # The dump says which database it came from. A shop's database takes only its own dump: the
    # file of another shop in a hurry would replace this shop's data with that shop's.
    origin="$(pg pg_restore --list <"$file" | sed -n 's/^; *dbname: //p' | head -n 1 | tr -d '\r')"
    if [[ "$origin" != "$target" && "${FORCE_DB_MISMATCH:-}" != 1 ]]; then
      die "$file is a dump of the database '${origin:-?}', not of '$target' ($shop): restoring it would put other data in this shop. FORCE_DB_MISMATCH=1 only if the database was renamed (moving a shop)."
    fi
    echo "This REPLACES the database '$target' of '$shop' with $file."
    echo "It stops api and web: EVERY shop on this server is offline until it ends. Tablets keep selling offline."
  else
    echo "This REPLACES database '$db' in the '$STACK' stack with $file."
  fi
  answer="${CONFIRM:-}"
  if [[ -z "$answer" ]]; then
    if multi_shop; then
      read -r -p "Type the shop name to continue ($confirm_name): " answer
    else
      read -r -p "Type the database name to continue: " answer
    fi
  fi
  [[ "$answer" == "$confirm_name" ]] || die "confirmation did not match; nothing changed"

  compose stop api web >/dev/null 2>&1 || true
  trap 'compose start api web >/dev/null 2>&1 || true' EXIT
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$1" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error' _ "$target" <"$file"
  # A new epoch: on their next pull, devices see it and download everything again (their sync
  # cursors point past the restored data). A dump older than the table gets its first epoch
  # from the migrations when the api starts. The control database has no such table.
  sql_in "$target" <<'SQL'
DO $$ BEGIN
  IF to_regclass('public.server_instance') IS NOT NULL THEN
    INSERT INTO server_instance (device_id) VALUES ('restore');
  END IF;
END $$;
SQL
  if multi_shop && [[ "$shop" != control ]]; then
    # Who replaced a shop's data, and with what, in the control database (not in the shop's own
    # audit_log: the restore may have just replaced that).
    sql_in "$(control_db)" -v "actor=$(id -un)" -v "slug=$shop" -v "file=$(basename "$file")" <<'SQL' ||
INSERT INTO shop_event (shop_id, actor, action, detail)
SELECT id, :'actor', 'shop.restored', jsonb_build_object('file', :'file', 'database', db_name)
FROM shop WHERE slug = :'slug'
SQL
      echo "warning: the restore is done, but its event was not written to the control database" >&2
  fi
else
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'PGOPTIONS="-c client_min_messages=warning" dropdb --username="$POSTGRES_USER" --if-exists "$1" && createdb --username="$POSTGRES_USER" "$1"' _ "$target"
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$1" --no-owner --no-privileges --single-transaction --exit-on-error' _ "$target" <"$file"
fi

echo "restore: $file → database '$target' ($STACK)"
