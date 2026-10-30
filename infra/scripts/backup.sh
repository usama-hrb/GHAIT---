#!/usr/bin/env bash
# Dump the application database of the running stack to $BACKUP_DIR as
# <db>_<UTC timestamp>.dump (pg_dump custom format, compressed), then keep only the
# newest $BACKUP_KEEP dumps. See docs/runbooks/backup.md.
#
# Usage: STACK=dev|prod infra/scripts/backup.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_postgres
db="$(app_db)"
dir="$(backup_dir)"
keep="$(env_get BACKUP_KEEP 14)"
[[ "$keep" =~ ^[1-9][0-9]*$ ]] || die "BACKUP_KEEP must be a positive integer (got '$keep')"

mkdir -p "$dir"
file="$dir/${db}_$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="$file.partial"
trap 'rm -f "$partial"' EXIT

# shellcheck disable=SC2016 # expanded inside the container
pg sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-privileges' >"$partial"

# A dump that pg_restore cannot list is not a backup.
pg pg_restore --list <"$partial" >/dev/null || die "pg_restore cannot read the dump; nothing kept"
mv "$partial" "$file"
echo "backup: $file ($(du -h "$file" | cut -f1))"

# Rotation: newest first, delete everything after the first $keep.
# shellcheck disable=SC2012 # names are generated (<db>_<timestamp>.dump); ls -t is the portable mtime sort
old="$(ls -1t "$dir/${db}"_*.dump | tail -n "+$((keep + 1))")"
if [[ -n "$old" ]]; then
  while IFS= read -r f; do rm -f -- "$f"; done <<<"$old"
  echo "rotation: removed $(wc -l <<<"$old" | tr -d ' ') old dump(s), kept $keep"
fi
