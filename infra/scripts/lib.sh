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
