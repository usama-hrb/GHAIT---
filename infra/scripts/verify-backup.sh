#!/usr/bin/env bash
# Prove a backup is restorable: take a fresh dump, restore it into a scratch database,
# compare the row count of every table with the live database, then drop the scratch copy.
#
# Usage: STACK=dev|prod infra/scripts/verify-backup.sh
#        KEEP_SCRATCH=1 keeps the scratch database for inspection.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_postgres
db="$(app_db)"
scratch="${db}_restore_check"

"$(dirname "$0")/backup.sh"
# shellcheck disable=SC2012 # names are generated (<db>_<timestamp>.dump); ls -t is the portable mtime sort
latest="$(ls -1t "$(backup_dir)/${db}"_*.dump | head -n 1)"

"$(dirname "$0")/restore.sh" "$latest" "$scratch"

# One "schema.table|rows" line per user table.
read -r -d '' COUNT_ROWS <<'SQL' || true
SELECT format('SELECT %L || ''|'' || count(*) FROM %I.%I', n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
ORDER BY 1
\gexec
SQL

counts() {
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'psql --username="$POSTGRES_USER" --dbname="$1" --no-psqlrc --tuples-only --no-align --quiet' _ "$1" <<<"$COUNT_ROWS"
}

live="$(counts "$db")"
restored="$(counts "$scratch")"

if [[ "${KEEP_SCRATCH:-}" != 1 ]]; then
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'PGOPTIONS="-c client_min_messages=warning" dropdb --username="$POSTGRES_USER" --if-exists "$1"' _ "$scratch"
fi

if [[ "$live" != "$restored" ]]; then
  echo "verify: MISMATCH between '$db' and the restored copy of $latest" >&2
  diff <(echo "$live") <(echo "$restored") >&2 || true
  exit 1
fi

tables=0
[[ -n "$live" ]] && tables="$(wc -l <<<"$live")"
echo "verify: OK, $latest restores with identical row counts ($tables tables)"
[[ -n "$live" ]] && column -t -s '|' <<<"$live"
exit 0
