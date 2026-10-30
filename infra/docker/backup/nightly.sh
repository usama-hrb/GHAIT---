#!/bin/sh
# The prod stack's `backup` service (compose.prod.yml): a pg_dump every day at $BACKUP_AT (UTC),
# into /backups (the host's $BACKUP_DIR), the same files and rotation as `make backup`
# (docs/runbooks/backup.md). A plain sleep loop instead of cron: it needs no root and no
# capabilities. The connection comes from the PG* variables.
set -eu

at="${BACKUP_AT:-02:30}"
keep="${BACKUP_KEEP:-14}"
case "$keep" in '' | *[!0-9]* | 0) echo "BACKUP_KEEP must be a positive integer" >&2; exit 2 ;; esac

backup() {
  file="/backups/${PGDATABASE}_$(date -u +%Y%m%dT%H%M%SZ).dump"
  if pg_dump --format=custom --compress=9 --no-owner --no-privileges >"$file.partial" &&
    pg_restore --list "$file.partial" >/dev/null; then
    mv "$file.partial" "$file"
    echo "backup: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.partial"
    echo "backup FAILED at $(date -u +%FT%TZ)" >&2
    return 1
  fi
  # shellcheck disable=SC2012 # generated names; newest first, keep $keep
  ls -1t /backups/"${PGDATABASE}"_*.dump | tail -n "+$((keep + 1))" | while IFS= read -r old; do
    rm -f -- "$old"
    echo "rotation: removed $old"
  done
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
