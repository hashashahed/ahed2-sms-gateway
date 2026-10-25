#!/usr/bin/env bash
# Installs the SMS gateway on a fresh Ubuntu 22.04/24.04 server with HTTPS for your domain.
# Usage (from the project folder, as root):   bash deploy/install.sh sms.yourdomain.com
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: bash deploy/install.sh your-domain.com"; exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run as root (or with sudo)."; exit 1
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/sms-gateway
DATA=/var/lib/sms-gateway

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

echo "==> Installing Node.js 22"
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing Caddy (automatic HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Copying the app to $APP"
id -u smsgw >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin smsgw
mkdir -p "$APP" "$DATA"
cp -r "$SRC/server/." "$APP/"
rm -rf "$APP/data" "$APP/node_modules"
cd "$APP" && npm install --omit=dev --no-audit --no-fund
chown -R smsgw:smsgw "$DATA"

if [[ ! -f /etc/sms-gateway.env ]]; then
  cat > /etc/sms-gateway.env <<EOF
PORT=3000
HOST=127.0.0.1
DATA_DIR=$DATA
EOF
fi

echo "==> Creating the service"
cat > /etc/systemd/system/sms-gateway.service <<EOF
[Unit]
Description=SMS Gateway
After=network.target

[Service]
User=smsgw
EnvironmentFile=/etc/sms-gateway.env
WorkingDirectory=$APP
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning src/server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now sms-gateway
systemctl restart sms-gateway

echo "==> Configuring HTTPS for $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy || systemctl restart caddy

echo "==> Opening the firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

sleep 2
if curl -fs http://127.0.0.1:3000/health >/dev/null; then
  echo
  echo "Done. Open https://$DOMAIN and register: the first account becomes the admin."
else
  echo "The service did not start. Check: journalctl -u sms-gateway -n 50"; exit 1
fi
