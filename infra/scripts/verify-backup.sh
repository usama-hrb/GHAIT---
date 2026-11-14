#!/usr/bin/env bash
# Prove a backup is restorable: take a fresh dump, restore it into a scratch database,
# compare the row count of every table with the live database, then drop the scratch copy.
# With MULTI_SHOP=true it does this for each shop that is not closed and for the control database
# (SHOP=<slug>|control checks one), and the scratch copy is <database>_restore_check.
#
# Usage: STACK=dev|prod [SHOP=<slug>|control|all] infra/scripts/verify-backup.sh
#        KEEP_SCRATCH=1 keeps the scratch databases for inspection.
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_postgres
here="$(dirname "$0")"

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

# verify_one LABEL DATABASE DIRECTORY: restore the newest dump of DATABASE from DIRECTORY into a
# scratch database and compare it with DATABASE. Prints the result; returns 1 on a mismatch.
verify_one() {
  local label="$1" db="$2" dir="$3" scratch latest live restored tables=0
  scratch="${db}_restore_check"
  ((${#scratch} <= 63)) || die "'$scratch' is longer than a database name can be (63)"
  latest="$(latest_dump "$db" "$dir")"

  # SHOP is for the target of a restore; a scratch copy has none.
  env -u SHOP "$here/restore.sh" "$latest" "$scratch"
  live="$(counts "$db")"
  restored="$(counts "$scratch")"

  if [[ "${KEEP_SCRATCH:-}" != 1 ]]; then
    # shellcheck disable=SC2016 # expanded inside the container
    pg sh -c 'PGOPTIONS="-c client_min_messages=warning" dropdb --username="$POSTGRES_USER" --if-exists "$1"' _ "$scratch"
  fi

  if [[ "$live" != "$restored" ]]; then
    echo "verify: MISMATCH between '$db' ($label) and the restored copy of $latest" >&2
    diff <(echo "$live") <(echo "$restored") >&2 || true
    return 1
  fi
  [[ -n "$live" ]] && tables="$(wc -l <<<"$live")"
  echo "verify: OK, $latest restores with identical row counts ($tables tables)"
  if [[ -z "${VERIFY_QUIET:-}" && -n "$live" ]]; then column -t -s '|' <<<"$live"; fi
  return 0
}

failed=()
if ! multi_shop; then
  [[ -z "${SHOP:-}" ]] || die "SHOP is only for MULTI_SHOP=true: this server has one shop"
  db="$(app_db)"
  "$here/backup.sh"
  verify_one "$db" "$db" "$(backup_dir)" || failed+=("$db")
else
  # One backup of what is being checked, then each target restored from its newest dump.
  "$here/backup.sh"
  targets="$(backup_targets "${SHOP:-}")"
  # With more than one database the row-count tables would fill the screen: one line each.
  [[ "$(wc -l <<<"$targets")" -gt 1 ]] && export VERIFY_QUIET=1
  # The list is read from fd 3: `docker compose exec` reads stdin, and would eat the rest of it.
  while read -r label db dir state <&3; do
    if [[ "$state" == provisioning ]] && ! database_exists "$db"; then
      echo "skipped: $label has no database yet (provisioning)"
      continue
    fi
    echo "verify: $label ($db)"
    verify_one "$label" "$db" "$dir" || failed+=("$label")
  done 3<<<"$targets"
fi

if ((${#failed[@]} > 0)); then
  echo "verify: FAILED for ${failed[*]}" >&2
  exit 1
fi
