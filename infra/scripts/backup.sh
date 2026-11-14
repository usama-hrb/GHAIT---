#!/usr/bin/env bash
# Dump the databases of the running stack to $BACKUP_DIR (pg_dump custom format, compressed), then
# keep only the newest $BACKUP_KEEP dumps of each database. See docs/runbooks/backup.md.
#
# One-shop server: the application database, as $BACKUP_DIR/<db>_<UTC timestamp>.dump.
# MULTI_SHOP=true: $BACKUP_DIR/<slug>/<database>_<UTC timestamp>.dump for each shop that is not
#   closed (suspended ones too), and $BACKUP_DIR/control/<control database>_<UTC timestamp>.dump for
#   the control database (ADR 0029). SHOP=<slug> backs up one shop, SHOP=control the control
#   database, SHOP=all or no SHOP every one of them. Rotation works on one directory at a time.
#
# Usage: STACK=dev|prod [SHOP=<slug>|control|all] infra/scripts/backup.sh
set -euo pipefail
source "$(dirname "$0")/lib.sh"

require_postgres
shop="${SHOP:-}"
PARTIAL=""
trap 'rm -f -- "$PARTIAL"' EXIT

failed=()
if ! multi_shop; then
  [[ -z "$shop" ]] || die "SHOP is only for MULTI_SHOP=true: this server has one shop"
  db="$(app_db)"
  dump_database "$db" "$(backup_dir)" || failed+=("$db")
else
  targets="$(backup_targets "$shop")"
  # The list is read from fd 3: `docker compose exec` reads stdin, and would eat the rest of it.
  while read -r label db dir state <&3; do
    # A shop that is still being made may have no database yet: nothing to dump, and not a failure.
    if [[ "$state" == provisioning ]] && ! database_exists "$db"; then
      echo "skipped: $label has no database yet (provisioning)"
      continue
    fi
    dump_database "$db" "$dir" || failed+=("$label")
  done 3<<<"$targets"
fi

if ((${#failed[@]} > 0)); then
  echo "backup: FAILED for ${failed[*]}" >&2
  exit 1
fi
