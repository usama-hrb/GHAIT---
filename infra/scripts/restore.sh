#!/usr/bin/env bash
# Restore a dump made by backup.sh.
#
# Usage: STACK=dev|prod infra/scripts/restore.sh <dump-file> [target-db]
#
# - target-db omitted: replaces the application database. Asks you to type its name first
#   (CONFIRM=<db name> skips the prompt) and stops api/web during the restore.
# - target-db given: (re)creates that database and restores into it, e.g. a scratch copy
#   to inspect or verify a backup. The application database is not touched.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

file="${1:-}"
[[ -n "$file" ]] || die "usage: restore.sh <dump-file> [target-db]"
[[ -f "$file" ]] || die "dump not found: $file"

require_postgres
db="$(app_db)"
target="${2:-$db}"
[[ "$target" =~ ^[a-z_][a-z0-9_]*$ ]] || die "invalid database name: $target"
pg pg_restore --list <"$file" >/dev/null || die "not a readable pg_dump archive: $file"

if [[ "$target" == "$db" ]]; then
  echo "This REPLACES database '$db' in the '$STACK' stack with $file."
  answer="${CONFIRM:-}"
  if [[ -z "$answer" ]]; then
    read -r -p "Type the database name to continue: " answer
  fi
  [[ "$answer" == "$db" ]] || die "confirmation did not match; nothing changed"

  compose stop api web >/dev/null 2>&1 || true
  trap 'compose start api web >/dev/null 2>&1 || true' EXIT
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error' <"$file"
else
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'PGOPTIONS="-c client_min_messages=warning" dropdb --username="$POSTGRES_USER" --if-exists "$1" && createdb --username="$POSTGRES_USER" "$1"' _ "$target"
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'pg_restore --username="$POSTGRES_USER" --dbname="$1" --no-owner --no-privileges --single-transaction --exit-on-error' _ "$target" <"$file"
fi

echo "restore: $file → database '$target' ($STACK)"
