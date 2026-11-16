#!/usr/bin/env bash
set -euo pipefail
if [[ "$(id -u)" -ne 0 ]]; then echo "Run as root: sudo bash install-systemd.sh" >&2; exit 1; fi
command -v node >/dev/null || { echo "Node.js 22+ is required." >&2; exit 1; }
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then echo "Node.js 22+ is required." >&2; exit 1; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NETWORK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BOT_DIR="$(cd "$NETWORK_DIR/.." && pwd)"
CREDENTIAL_FILE="${HASA_AGENT_TOKEN_FILE:-/var/lib/hasa-agent/credentials.json}"
AGENT_ENV="/etc/hasa-agent/agent.env"
DATA_DIR="/var/lib/hasa-worker/sessions"
if [[ ! -f "$CREDENTIAL_FILE" || ! -f "$AGENT_ENV" ]]; then
  echo "Enroll this server first with hasa-agent and ensure $CREDENTIAL_FILE exists." >&2; exit 1
fi
if ! command -v mountpoint >/dev/null || ! mountpoint -q "$DATA_DIR"; then
  echo "$DATA_DIR must already be an encrypted filesystem mount point. Mount it before installing the worker." >&2; exit 1
fi
API_URL="$(sed -n 's/^HASA_AGENT_API_URL=//p' "$AGENT_ENV" | tail -n1)"
AGENT_TOKEN="$(node -e 'const fs=require("fs");const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));if(typeof x.agent_token!=="string"||x.agent_token.length<32)process.exit(2);process.stdout.write(x.agent_token)' "$CREDENTIAL_FILE")"
if [[ -z "$API_URL" || -z "$AGENT_TOKEN" ]]; then echo "Could not read the enrolled agent API URL/token." >&2; exit 1; fi
if ! id hasa-worker >/dev/null 2>&1; then useradd --system --home-dir /var/lib/hasa-worker --create-home --shell /usr/sbin/nologin hasa-worker; fi
install -d -o root -g root -m 0755 /opt/hasa-network
cp -a "$NETWORK_DIR/." /opt/hasa-network/
cd /opt/hasa-network
npm install --omit=dev --no-audit --no-fund
chown -R root:root /opt/hasa-network
install -d -o root -g root -m 0755 /opt/hasa-bot
tar -C "$BOT_DIR" --exclude=.git --exclude=node_modules --exclude=network --exclude=auth_info --exclude=auth_info_backup --exclude=data --exclude=downloads --exclude=config.json --exclude=.env --exclude=logs -cf - . | tar -C /opt/hasa-bot -xf -
cd /opt/hasa-bot
npm install --omit=dev --no-audit --no-fund
chown -R root:root /opt/hasa-bot
install -d -o root -g hasa-worker -m 0750 /etc/hasa-worker
chown -R hasa-worker:hasa-worker "$DATA_DIR"
chmod 0700 "$DATA_DIR"
if [[ ! -f /etc/hasa-worker/worker.env ]]; then
  {
    printf 'HASA_AGENT_API_URL=%s\n' "$API_URL"
    printf 'HASA_AGENT_TOKEN=%s\n' "$AGENT_TOKEN"
    printf 'HASA_WHATSAPP_DATA_DIR=%s\n' "$DATA_DIR"
    printf 'HASA_WHATSAPP_DATA_ENCRYPTED=true\n'
    printf 'HASA_WORKER_MAX_SESSIONS=1\n'
    printf 'LOG_LEVEL=warn\n'
  } > /etc/hasa-worker/worker.env
  chown root:hasa-worker /etc/hasa-worker/worker.env
  chmod 0640 /etc/hasa-worker/worker.env
else
  echo "Kept existing /etc/hasa-worker/worker.env unchanged; review its token and API URL if enrollment changed."
fi
sed "s|/usr/bin/node|$NODE_BIN|" "$SCRIPT_DIR/hasa-worker.service" > /etc/systemd/system/hasa-worker.service
systemctl daemon-reload
echo "Worker installed. Review /etc/hasa-worker/worker.env, then run:"
echo "  systemctl enable --now hasa-worker"
