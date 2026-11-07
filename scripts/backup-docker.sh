#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DESTINATION="${1:-$ROOT/backups}"
mkdir -p "$DESTINATION"
CONTAINER_ID="$(docker compose ps -q backend)"
[ -n "$CONTAINER_ID" ] || { echo "Backend container is not running."; exit 1; }
docker cp scripts/backup.py "$CONTAINER_ID:/tmp/stemora-backup.py"
# Deployment staging may use umask 077; this public source file must be readable
# by the unprivileged backend user after docker cp assigns root ownership.
docker exec --user root "$CONTAINER_ID" chmod 0644 /tmp/stemora-backup.py
docker compose exec -T backend env PYTHONPATH=/app python /tmp/stemora-backup.py --output /data/backups
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
docker cp "$CONTAINER_ID:/data/backups/." "$STAGING/"
cp -R "$STAGING/." "$DESTINATION/"
chmod -R go-rwx "$DESTINATION"
DATABASE_ID="$(docker compose ps -q database)"
if [ -n "$DATABASE_ID" ]; then
    LATEST="$(find "$STAGING" -name manifest.json -print | LC_ALL=C sort | tail -n 1)"
    SNAPSHOT="$(basename "$(dirname "$LATEST")")"
    umask 077
    DUMP="$DESTINATION/$SNAPSHOT/postgresql.dump"
    docker compose exec -T database pg_dump -U postgres -d stemora --format=custom > "$DUMP.partial"
    mv "$DUMP.partial" "$DUMP"
fi
echo "Private backup copied to $DESTINATION. Keep an encrypted copy off this server."
