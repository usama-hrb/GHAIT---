#!/bin/sh
# The prod stack's `backup` service (compose.prod.yml): a pg_dump every day at $BACKUP_AT (UTC),
# into /backups (the host's $BACKUP_DIR), the same files and rotation as `make backup`
# (docs/runbooks/backup.md). A plain sleep loop instead of cron: it needs no root and no
# capabilities. The connection comes from the PG* variables.
#
# With MULTI_SHOP=true (ADR 0029) it reads the shops from the control database, dumps each one that
# is not closed (suspended ones too) to /backups/<slug>/<database>_<UTC>.dump, and then dumps the
# control database to /backups/control/. Rotation works on one directory at a time and removes only
# files named <that database>_<time>.dump. One shop that fails to dump does not stop the others: the
# run goes on and ends as a failure.
set -eu

at="${BACKUP_AT:-02:30}"
keep="${BACKUP_KEEP:-14}"
case "$keep" in '' | *[!0-9]* | 0) echo "BACKUP_KEEP must be a positive integer" >&2; exit 2 ;; esac
control="${CONTROL_DATABASE_NAME:-fabric_control}"
# Where the dumps go. The container's mount is /backups; only the test of this script sets another.
root="${BACKUP_ROOT:-/backups}"
# The words the API takes for a boolean.
case "$(printf '%s' "${MULTI_SHOP:-false}" | tr 'A-Z' 'a-z')" in
  true | 1 | yes | on | y | enabled) multi=1 ;;
  *) multi=0 ;;
esac

# dump DATABASE DIRECTORY: one dump, checked with pg_restore --list, then the newest $keep dumps of
# this database in this directory are kept. The names hold the time, so they are sorted by name.
dump() {
  local db="$1" dir="$2" file
  mkdir -p "$dir"
  file="$dir/${db}_$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump --dbname="$db" --format=custom --compress=9 --no-owner --no-privileges >"$file.partial" &&
    pg_restore --list "$file.partial" >/dev/null; then
    mv "$file.partial" "$file"
    echo "backup: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "backup FAILED for $db at $(date -u +%FT%TZ)" >&2
    return 1
  fi
  # shellcheck disable=SC2012 # generated names; newest first by name, keep $keep
  ls -1 "$dir/${db}"_????????T??????Z.dump 2>/dev/null | sort -r | tail -n "+$((keep + 1))" | while IFS= read -r old; do
    rm -f -- "$old"
    echo "rotation: removed $old"
  done
}

# has_database NAME: the name comes from the control database, which only keeps [a-z0-9_] names.
has_database() {
  [ "$(psql --dbname="$control" --no-psqlrc --tuples-only --no-align --quiet \
    --command "SELECT 1 FROM pg_database WHERE datname = '$1'")" = 1 ]
}

backup() {
  if [ "$multi" != 1 ]; then
    dump "$PGDATABASE" "$root"
    return
  fi
  failed=0
  if shops="$(psql --dbname="$control" --no-psqlrc --tuples-only --no-align --quiet \
    --field-separator=' ' \
    --command "SELECT slug, db_name, state FROM shop WHERE state <> 'closed' ORDER BY created_at, slug")"; then
    while read -r slug db state; do
      [ -n "$slug" ] || continue
      # A shop that is still being made may have no database yet: nothing to dump, not a failure.
      if [ "$state" = provisioning ] && ! has_database "$db"; then
        echo "skipped: $slug has no database yet (provisioning)"
        continue
      fi
      dump "$db" "$root/$slug" || failed=1
    done <<EOF
$shops
EOF
  else
    echo "backup FAILED: cannot read the list of shops from $control" >&2
    failed=1
  fi
  # The control database is dumped whatever happened to the shops.
  dump "$control" "$root/control" || failed=1
  return "$failed"
}

# `BACKUP_ONCE=1`: one backup now, then exit (to check the setup, docs/runbooks/deploy.md).
if [ "${BACKUP_ONCE:-0}" = 1 ]; then
  backup
  exit
fi

echo "nightly backups at $at UTC, keeping $keep"
while :; do
  now="$(date -u +%s)"
  next="$(date -u -d "$(date -u +%Y-%m-%d) $at" +%s)"
  [ "$next" -gt "$now" ] || next=$((next + 86400))
  sleep $((next - now))
  backup || true
done
