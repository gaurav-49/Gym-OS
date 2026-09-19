#!/usr/bin/env bash
# Nightly database backup for GYM OS.
#
# Installed by the deploy as /etc/cron.d/gym-os-backup; also runnable by hand:
#
#   sudo /opt/gym-os/deploy/backup.sh
#
# Writes a compressed pg_dump to BACKUP_DIR and deletes ones older than
# KEEP_DAYS. Custom format (-Fc), so a single table can be pulled out of a
# dump without restoring the whole thing.
#
#   GYMOS_DIR    default /opt/gym-os
#   BACKUP_DIR   default $GYMOS_DIR/backups
#   KEEP_DAYS    default 14
#
# This is a local copy on the same disk as the database: it covers a bad
# migration, a mistaken DELETE, or a container rebuild — NOT the machine
# going away. Copy them off the box for that (Oracle Object Storage is free
# at this size).

set -euo pipefail

GYMOS_DIR="${GYMOS_DIR:-/opt/gym-os}"
BACKUP_DIR="${BACKUP_DIR:-$GYMOS_DIR/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PROJECT="${PROJECT:-gym-os}"

cd "$GYMOS_DIR"

db_user=$(grep -E '^DB_USER=' .env 2>/dev/null | cut -d= -f2- || true); db_user=${db_user:-gymos}
db_name=$(grep -E '^DB_NAME=' .env 2>/dev/null | cut -d= -f2- || true); db_name=${db_name:-gymdb}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp=$(date +%Y-%m-%dT%H-%M-%S)
out="$BACKUP_DIR/gymdb-$stamp.dump"

# < /dev/null: docker compose exec forwards stdin, and this runs from cron
# (and from deploy scripts that are themselves piped to bash) where stdin is
# not a terminal.
docker compose -p "$PROJECT" exec -T postgres \
    pg_dump -U "$db_user" -d "$db_name" -Fc < /dev/null > "$out.partial"

# Rename only once pg_dump has exited 0, so a half-written file is never
# mistaken for a usable backup.
mv "$out.partial" "$out"
chmod 600 "$out"

find "$BACKUP_DIR" -name 'gymdb-*.dump' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name '*.partial' -mtime +1 -delete

echo "$(date -Is) backup ok: $out ($(du -h "$out" | cut -f1))"
