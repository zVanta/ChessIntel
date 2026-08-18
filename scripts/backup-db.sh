#!/usr/bin/env bash
# Snapshot the SQLite database using better-sqlite3's online backup, so the
# copy is consistent even while the web app is writing.
#
# Usage:   ./scripts/backup-db.sh
# Cron:    0 3 * * * cd /opt/chessintel && ./scripts/backup-db.sh >> /var/log/chess-backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
STAMP="$(date +%F-%H%M%S)"
DEST="/data/backup-${STAMP}.db"

docker compose exec -T web node -e "
  const Database = require('better-sqlite3');
  const db = new Database('/data/chess.db');
  db.backup('${DEST}')
    .then(() => { console.log('Backed up to ${DEST}'); db.close(); })
    .catch((e) => { console.error(e); db.close(); process.exit(1); });
"

# Prune old backups, keeping the 7 most recent.
docker compose exec -T web sh -c 'ls -1t /data/backup-*.db 2>/dev/null | tail -n +8 | xargs -r rm -f'

echo "Backup complete: ${DEST}"
