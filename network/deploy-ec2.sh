#!/usr/bin/env bash
set -Eeuo pipefail

# HASA BOT NETWORK control-plane bootstrap for Amazon Linux 2023.
# Installs only the website/API and PostgreSQL. It never touches the Oracle bot,
# WhatsApp auth files, PM2, or the isolated worker.
if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo: sudo bash network/deploy-ec2.sh" >&2
  exit 1
fi
APP_USER="ec2-user"
REPO_DIR="/home/ec2-user/hasa-network"
APP_DIR="/opt/hasa-network"
ENV_DIR="/etc/hasa-network"
ENV_FILE="$ENV_DIR/network.env"
SERVICE_FILE="/etc/systemd/system/hasa-network.service"

[[ -d "$REPO_DIR/network" ]] || { echo "Expected repository at $REPO_DIR; clone the feature branch first." >&2; exit 1; }
NODE_BIN="$(su - "$APP_USER" -c 'command -v node' 2>/dev/null || true)"
NPM_BIN="$(su - "$APP_USER" -c 'command -v npm' 2>/dev/null || true)"
[[ -n "$NODE_BIN" && -n "$NPM_BIN" ]] || { echo "Node.js 22+ via ec2-user NVM is required. Install/activate Node 22, then rerun." >&2; exit 1; }
NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 22 ]] || { echo "Node.js 22+ required; found $("$NODE_BIN" -v)." >&2; exit 1; }

dnf install -y postgresql15 postgresql15-server openssl
if [[ ! -f /var/lib/pgsql/data/PG_VERSION ]]; then
  /usr/bin/postgresql-setup --initdb
fi
systemctl enable --now postgresql

# Keep PostgreSQL local-only.
sed -i -E "s/^#?listen_addresses[[:space:]]*=.*/listen_addresses = '127.0.0.1'/" /var/lib/pgsql/data/postgresql.conf
systemctl restart postgresql

install -d -o root -g "$APP_USER" -m 0750 "$APP_DIR" "$ENV_DIR"
cp -a "$REPO_DIR/network/." "$APP_DIR/"
chown -R root:"$APP_USER" "$APP_DIR"
chmod -R o-rwx "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR/node_modules"

if [[ ! -f "$ENV_FILE" ]]; then
  DB_PASS="$(openssl rand -hex 32)"
  OWNER_KEY="$(openssl rand -hex 48)"
  PAIRING_KEY="$(openssl rand -base64 32)"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hasa_network') THEN CREATE ROLE hasa_network LOGIN PASSWORD '$DB_PASS'; ELSE ALTER ROLE hasa_network WITH LOGIN PASSWORD '$DB_PASS'; END IF; END \$\$;"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='hasa_network'" | grep -q 1 || sudo -u postgres createdb -O hasa_network hasa_network
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HASA_API_HOST=127.0.0.1
HASA_API_PORT=8787
DATABASE_URL=postgresql://hasa_network:$DB_PASS@127.0.0.1:5432/hasa_network
HASA_OWNER_ACCESS_KEY=$OWNER_KEY
HASA_PAIRING_CODE_KEY=$PAIRING_KEY
HASA_MIN_FREE_MEMORY_BYTES=268435456
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 0640 "$ENV_FILE"
  echo "Created private deployment secrets at $ENV_FILE (not printed)."
else
  echo "Keeping existing secrets in $ENV_FILE."
  DB_PASS="$(sed -n 's/^DATABASE_URL=postgresql:\/\/hasa_network:\([^@]*\)@.*/\1/p' "$ENV_FILE")"
  [[ -n "$DB_PASS" ]] || { echo "Existing DATABASE_URL format not recognized; refusing to alter database credentials." >&2; exit 1; }
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hasa_network') THEN CREATE ROLE hasa_network LOGIN PASSWORD '$DB_PASS'; ELSE ALTER ROLE hasa_network WITH LOGIN PASSWORD '$DB_PASS'; END IF; END \$\$;"
  sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='hasa_network'" | grep -q 1 || sudo -u postgres createdb -O hasa_network hasa_network
fi

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
su - "$APP_USER" -c "cd '$APP_DIR' && '$NPM_BIN' install --omit=dev --no-audit --no-fund && '$NPM_BIN' run check"
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a
su - "$APP_USER" -c "cd '$APP_DIR' && DATABASE_URL='$DATABASE_URL' '$NODE_BIN' db/migrate.js"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=HASA BOT NETWORK control plane
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
LockPersonality=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=420M
TasksMax=128

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now hasa-network
sleep 2
systemctl --no-pager --full status hasa-network || true
curl --fail --silent --show-error http://127.0.0.1:8787/healthz
echo
curl --fail --silent --show-error http://127.0.0.1:8787/readyz
echo
echo
echo "HASA BOT NETWORK API and website are installed locally."
echo "Website/API bind: 127.0.0.1:8787 (intentionally not public until HTTPS is configured)."
echo "Owner secret file: $ENV_FILE (HASA_OWNER_ACCESS_KEY). Keep it private."
echo "RAM reserve: 256 MiB. Customer bot workers remain DISABLED until HTTPS and encrypted session storage are configured."
