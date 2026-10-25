#!/usr/bin/env bash
# Makes a consistent copy of the database. Run daily from cron:
#   echo "0 3 * * * root bash /opt/sms-gateway-src/deploy/backup.sh" > /etc/cron.d/sms-gateway-backup
set -euo pipefail
DATA=/var/lib/sms-gateway
OUT=/var/backups/sms-gateway
mkdir -p "$OUT"
STAMP=$(date +%Y-%m-%d)
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('$DATA/saas.db');
db.exec(\"VACUUM INTO '$OUT/saas-$STAMP.db'\");
" 2>/dev/null
cp -f "$DATA/app.apk" "$OUT/app.apk" 2>/dev/null || true
# keep the last 14 days
ls -1t "$OUT"/saas-*.db | tail -n +15 | xargs -r rm -f
echo "Backup saved: $OUT/saas-$STAMP.db"
