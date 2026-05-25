#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/deploy}"
ENV_FILE="${ENV_FILE:-$DEPLOY_DIR/.env}"
DB_CONTAINER="${DB_CONTAINER:-shared_db}"
DB_NAME="${DB_NAME:-macro_tracker}"
DB_USER="${DB_USER:-admin}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups/macros}"
RESTORE_DRILL="${RESTORE_DRILL:-false}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

read_env_value() {
  local key="$1"
  local file="$2"
  local line value

  line="$(grep -m 1 "^${key}=" "$file" || true)"
  if [ -z "$line" ]; then
    return 1
  fi

  value="${line#*=}"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi

  printf '%s' "$value"
}

require_command docker
require_command grep
require_command date
require_command du
require_command find

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing production env file: $ENV_FILE" >&2
  exit 1
fi

DB_PASSWORD="${DB_PASSWORD:-$(read_env_value DB_PASSWORD "$ENV_FILE" || true)}"
if [ -z "$DB_PASSWORD" ]; then
  echo "Set DB_PASSWORD or add DB_PASSWORD to $ENV_FILE." >&2
  exit 1
fi

case "$RETENTION_DAYS" in
  ''|*[!0-9]*)
    echo "RETENTION_DAYS must be a non-negative integer." >&2
    exit 1
    ;;
esac

prune_old_backups() {
  if [ "$RETENTION_DAYS" -eq 0 ]; then
    echo "Skipping local backup pruning because RETENTION_DAYS is 0."
    return
  fi

  echo "Pruning local backups older than ${RETENTION_DAYS} days from $BACKUP_DIR..."
  find "$BACKUP_DIR" -type f -name 'macro-tracker-*.dump' -mtime +"$RETENTION_DAYS" -delete
}

timestamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
backup_path="$BACKUP_DIR/macro-tracker-${timestamp}.dump"

umask 077
mkdir -p "$BACKUP_DIR"

echo "Checking database connectivity..."
docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
  pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null

echo "Creating backup: $backup_path"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner --no-privileges > "$backup_path"
chmod 600 "$backup_path"
echo "Backup created: $backup_path ($(du -h "$backup_path" | awk '{print $1}'))"

if [ "$RESTORE_DRILL" != "true" ]; then
  echo "Skipping restore drill because RESTORE_DRILL is not true."
  prune_old_backups
  exit 0
fi

restore_db="${RESTORE_DB:-macro_tracker_restore_check_${timestamp//[-TZ]/_}}"
restore_created=false

cleanup_restore_db() {
  if [ "$restore_created" = "true" ]; then
    docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
      dropdb -U "$DB_USER" --if-exists "$restore_db" >/dev/null 2>&1 || true
  fi
}

trap cleanup_restore_db EXIT

echo "Creating restore database: $restore_db"
docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
  createdb -U "$DB_USER" "$restore_db"
restore_created=true

echo "Restoring backup into: $restore_db"
docker exec -i -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
  pg_restore -U "$DB_USER" -d "$restore_db" --no-owner --no-privileges < "$backup_path"

table_count="$(
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$restore_db" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema();"
)"
restored_size="$(
  docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
    psql -U "$DB_USER" -d "$restore_db" -Atc "SELECT pg_size_pretty(pg_database_size(current_database()));"
)"

if [ "${table_count:-0}" -lt 1 ]; then
  echo "Restore drill failed: restored database has no public tables." >&2
  exit 1
fi

docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
  dropdb -U "$DB_USER" "$restore_db"
restore_created=false

echo "Restore drill passed: ${table_count} public tables, restored size ${restored_size}."
echo "Dropped restore database: $restore_db"
prune_old_backups
