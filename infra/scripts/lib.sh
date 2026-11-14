# Shared helpers for infra/scripts/*.sh. Source it; do not run it.
# shellcheck shell=bash

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK="${STACK:-dev}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
COMPOSE_FILE="$ROOT/infra/docker/compose.$STACK.yml"

die() {
  echo "error: $*" >&2
  exit 1
}

[[ -f "$COMPOSE_FILE" ]] || die "unknown STACK '$STACK' (expected dev or prod)"
[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found (copy .env.example to .env)"

# env_get KEY DEFAULT: the exported value, else the value in .env, else DEFAULT.
# .env is parsed, never sourced.
env_get() {
  local key="$1" default="$2" value
  value="${!key:-}"
  if [[ -z "$value" ]]; then
    value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  fi
  echo "${value:-$default}"
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

# Run a command inside the running postgres container (credentials come from its environment).
pg() {
  compose exec -T postgres "$@"
}

require_postgres() {
  pg pg_isready -q >/dev/null 2>&1 || die "postgres is not running in the '$STACK' stack (make up STACK=$STACK)"
}

app_db() {
  pg printenv POSTGRES_DB | tr -d '\r'
}

backup_dir() {
  local dir
  dir="$(env_get BACKUP_DIR ./backups)"
  [[ "$dir" = /* ]] || dir="$ROOT/${dir#./}"
  echo "$dir"
}

# ── Many shops (ADR 0029, Step 8) ───────────────────────────────────────────────────────────────

# True when this server serves many shops: MULTI_SHOP=true in the environment or in .env, with the
# words the API takes for a boolean.
multi_shop() {
  case "$(env_get MULTI_SHOP false | tr '[:upper:]' '[:lower:]')" in
    true | 1 | yes | on | y | enabled) return 0 ;;
    *) return 1 ;;
  esac
}

control_db() {
  env_get CONTROL_DATABASE_NAME fabric_control
}

# sql_in DATABASE [psql arguments…]: run the SQL on stdin in DATABASE and print the rows, one per
# line, fields separated by a space. A value is passed with -v name=value and used as :'name'.
sql_in() {
  local db="$1"
  shift
  # shellcheck disable=SC2016 # expanded inside the container
  pg sh -c 'db="$1"; shift; psql --username="$POSTGRES_USER" --dbname="$db" --no-psqlrc --tuples-only --no-align --field-separator=" " --quiet -v ON_ERROR_STOP=1 "$@"' _ "$db" "$@"
}

# shop_rows [SLUG]: "<slug> <database> <state>" for each shop that is not closed (suspended ones
# too), oldest first, or only for SLUG. Dies when the control database cannot be read.
shop_rows() {
  local only="${1:-}" filter=""
  if [[ -n "$only" ]]; then
    [[ "$only" =~ ^[a-z][a-z0-9_]{2,30}$ ]] || die "'$only' is not a shop name"
    filter="AND slug = '$only'"
  fi
  sql_in "$(control_db)" <<<"SELECT slug, db_name, state FROM shop WHERE state <> 'closed' $filter ORDER BY created_at, slug" ||
    die "cannot read the list of shops from the control database '$(control_db)'"
}

# database_exists NAME: true when the server has a database with that name.
database_exists() {
  [[ "$1" =~ ^[a-z_][a-z0-9_]*$ ]] || die "invalid database name: $1"
  [[ "$(sql_in postgres <<<"SELECT 1 FROM pg_database WHERE datname = '$1'")" == 1 ]]
}

# backup_targets [SELECTOR]: what to back up, as "<label> <database> <directory> <state>" lines.
# SELECTOR "" or all: every shop that is not closed, then the control database; control: the
# control database; anything else: the shop with that name. A shop's dumps go to <dir>/<slug>/ and
# the control database's to <dir>/control/ ("control" is not a possible shop name), so no two
# databases share a directory.
backup_targets() {
  local selector="${1:-}" dir rows slug db state
  dir="$(backup_dir)"
  case "$selector" in
    '' | all)
      rows="$(shop_rows)"
      while read -r slug db state; do
        [[ -n "$slug" ]] && echo "$slug $db $dir/$slug $state"
      done <<<"$rows"
      echo "control $(control_db) $dir/control active"
      ;;
    control)
      echo "control $(control_db) $dir/control active"
      ;;
    *)
      rows="$(shop_rows "$selector")"
      [[ -n "$rows" ]] || die "there is no open shop '$selector' (make shop-list)"
      read -r slug db state <<<"$rows"
      echo "$slug $db $dir/$slug $state"
      ;;
  esac
}

# dump_database DATABASE DIRECTORY: pg_dump DATABASE into DIRECTORY/<DATABASE>_<UTC time>.dump (custom
# format, compressed), check that pg_restore can read it, then keep the newest $BACKUP_KEEP dumps of
# DATABASE in DIRECTORY. The names hold the time, so they are sorted by name, not by file date (a
# copied directory has new dates). Only files named <DATABASE>_<time>.dump are ever removed. Returns
# 1, with nothing kept, when the dump or the check fails.
dump_database() {
  local db="$1" dir="$2" keep file partial
  keep="$(env_get BACKUP_KEEP 14)"
  [[ "$keep" =~ ^[1-9][0-9]*$ ]] || die "BACKUP_KEEP must be a positive integer (got '$keep')"
  mkdir -p "$dir"
  file="$dir/${db}_$(date -u +%Y%m%dT%H%M%SZ).dump"
  partial="$file.partial"
  PARTIAL="$partial"
  # shellcheck disable=SC2016 # expanded inside the container
  if ! pg sh -c 'pg_dump --username="$POSTGRES_USER" --dbname="$1" --format=custom --compress=9 --no-owner --no-privileges' _ "$db" >"$partial"; then
    rm -f -- "$partial"
    echo "backup FAILED: pg_dump could not dump '$db'" >&2
    return 1
  fi
  # A dump that pg_restore cannot list is not a backup.
  if ! pg pg_restore --list <"$partial" >/dev/null; then
    rm -f -- "$partial"
    echo "backup FAILED: pg_restore cannot read the dump of '$db'; nothing kept" >&2
    return 1
  fi
  mv "$partial" "$file"
  PARTIAL=""
  echo "backup: $file ($(du -h "$file" | cut -f1))"

  local files=() drop old
  shopt -s nullglob
  files=("$dir/${db}"_????????T??????Z.dump)
  shopt -u nullglob
  if ((${#files[@]} > keep)); then
    drop=$((${#files[@]} - keep))
    for old in "${files[@]:0:drop}"; do rm -f -- "$old"; done
    echo "rotation: removed $drop old dump(s) of '$db', kept $keep"
  fi
}

# latest_dump DATABASE DIRECTORY: the newest dump that dump_database made of DATABASE in DIRECTORY.
latest_dump() {
  local files=()
  shopt -s nullglob
  files=("$2/$1"_????????T??????Z.dump)
  shopt -u nullglob
  ((${#files[@]} > 0)) || die "no dump of '$1' in $2"
  echo "${files[$((${#files[@]} - 1))]}"
}
