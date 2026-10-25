#!/usr/bin/env bash
# Pulls the latest code and restarts the service. Your data (accounts, messages) is kept.
# Usage (from the project folder, as root):   bash deploy/update.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/sms-gateway

cd "$SRC" && git pull --ff-only
cp -r "$SRC/server/src" "$SRC/server/public" "$SRC/server/package.json" "$APP/"
cd "$APP" && npm install --omit=dev --no-audit --no-fund
systemctl restart sms-gateway
sleep 2
curl -fs http://127.0.0.1:3000/health >/dev/null && echo "Updated ✓" || { echo "Service failed, see: journalctl -u sms-gateway -n 50"; exit 1; }
