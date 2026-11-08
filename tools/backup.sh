#!/usr/bin/env bash
# Read-only backup: mongodump of the database in MONGODB_URI into backups/<name>.archive.gz.
# The connection string is never printed. See docs/BACKUP.md.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${MONGODB_URI:-}" && -f .env ]]; then
  MONGODB_URI="$(grep -E '^MONGODB_URI=' .env | head -n1 | cut -d= -f2-)"
fi
if [[ -z "${MONGODB_URI:-}" ]]; then
  echo "MONGODB_URI is not set (in the environment or .env)." >&2
  exit 1
fi
if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump not found. Install the MongoDB Database Tools (macOS: brew install mongodb-database-tools)." >&2
  exit 1
fi

mkdir -p backups
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
out="backups/noma-${stamp}.archive.gz"
mongodump --uri="$MONGODB_URI" --gzip --archive="$out" --quiet
echo "Backup written to $out ($(du -h "$out" | cut -f1))."
