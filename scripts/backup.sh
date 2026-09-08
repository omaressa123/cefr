#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and set production secrets." >&2
  exit 1
fi

set -a
. ./.env
set +a

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"

backup_dir="${BACKUP_DIR:-./backups}"
mkdir -p "$backup_dir"
work_dir="$(mktemp -d)"
backup_file="$backup_dir/backup-$(date -u +%Y-%m-%dT%H-%M-%SZ).tar.gz"
trap 'rm -rf "$work_dir"' EXIT

mkdir -p "$work_dir/data" "$work_dir/uploads" "$work_dir/config"

echo "Dumping database..."
docker compose exec -T database mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --no-tablespaces \
  -u"$MYSQL_USER" \
  -p"$MYSQL_PASSWORD" \
  "$MYSQL_DATABASE" > "$work_dir/database.sql"

if [[ -d data ]]; then
  cp -a data/. "$work_dir/data/" 2>/dev/null || true
  rm -rf "$work_dir/data/database"
fi
if [[ -d uploads ]]; then
  cp -a uploads/. "$work_dir/uploads/" 2>/dev/null || true
fi

cp docker-compose.yml "$work_dir/config/"
cp .env.example "$work_dir/config/"
cp backend/.env.example "$work_dir/config/"

tar -czf "$backup_file" -C "$work_dir" database.sql data uploads config
chmod 600 "$backup_file"

echo "Created $backup_file"
