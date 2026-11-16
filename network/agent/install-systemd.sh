#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer as root: sudo bash install-systemd.sh" >&2
  exit 1
fi
command -v node >/dev/null || { echo "Node.js 22 or newer is required." >&2; exit 1; }
NODE_VERSION="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_VERSION" -lt 22 ]]; then echo "Node.js 22 or newer is required." >&2; exit 1; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="$(command -v node)"

if ! id hasa-agent >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/hasa-agent --create-home --shell /usr/sbin/nologin hasa-agent
fi
install -d -o root -g root -m 0755 /opt/hasa-agent
install -d -o root -g root -m 0755 /opt/hasa-agent/src
install -d -o root -g hasa-agent -m 0750 /etc/hasa-agent
install -d -o hasa-agent -g hasa-agent -m 0700 /var/lib/hasa-agent
install -m 0644 "$SCRIPT_DIR/src/agent.js" /opt/hasa-agent/src/agent.js
sed "s|/usr/bin/node|$NODE_BIN|" "$SCRIPT_DIR/hasa-agent.service" > /etc/systemd/system/hasa-agent.service
if [[ ! -f /etc/hasa-agent/agent.env ]]; then
  cat > /etc/hasa-agent/agent.env <<'EOF'
HASA_AGENT_API_URL=https://YOUR-CONTROL-PLANE-HOST
HASA_AGENT_ENROLLMENT_TICKET=PASTE_ONE_TIME_TICKET_HERE
HASA_AGENT_TOKEN_FILE=/var/lib/hasa-agent/credentials.json
HASA_AGENT_DATA_PATH=/
HASA_AGENT_INTERVAL_SECONDS=60
EOF
  chown root:hasa-agent /etc/hasa-agent/agent.env
  chmod 0640 /etc/hasa-agent/agent.env
  echo "Created /etc/hasa-agent/agent.env. Edit it with the HTTPS API URL and one-time ticket."
else
  echo "Kept existing /etc/hasa-agent/agent.env unchanged."
fi
systemctl daemon-reload
echo "Agent files installed. Configure /etc/hasa-agent/agent.env, then run:"
echo "  systemctl enable --now hasa-agent"
echo "After successful enrollment, remove HASA_AGENT_ENROLLMENT_TICKET from the env file and restart the service."
