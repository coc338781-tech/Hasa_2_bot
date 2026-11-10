#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

echo "Hasa Termux Agent - one-time secure setup"
command -v node >/dev/null || { echo "Node.js missing. Run: pkg install nodejs-lts curl -y"; exit 1; }
command -v curl >/dev/null || { echo "curl missing. Run: pkg install curl -y"; exit 1; }

AGENT_DIR="$HOME/.local/share/hasa-termux-agent"
CONFIG_DIR="$HOME/.config/hasa-termux-agent"
mkdir -p "$AGENT_DIR" "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR" "$AGENT_DIR"

GH_TOKEN=""
if [ -f "$CONFIG_DIR/config.json" ]; then
  GH_TOKEN="$(node -e 'try { process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).token || "") } catch {}' "$CONFIG_DIR/config.json")"
fi
if [ -z "$GH_TOKEN" ]; then
  read -rsp "Paste a fine-grained GitHub token (only hasa-bot-test-reports: Contents read/write): " GH_TOKEN < /dev/tty
  echo
fi
[ -n "$GH_TOKEN" ] || { echo "No token supplied."; exit 1; }

API="https://api.github.com/repos/coc338781-tech/hasa-bot-test-reports/contents/termux-agent/agent.mjs?ref=main"
TMP="$(mktemp)"
trap 'rm -f "$TMP"; unset GH_TOKEN' EXIT
if ! curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$API" -o "$TMP"; then
  echo "Could not access the private agent file. Check token repository access and Contents: Read."
  exit 1
fi

AGENT_BACKUP=""
if [ -f "$AGENT_DIR/agent.mjs" ]; then
  AGENT_BACKUP="$AGENT_DIR/agent.mjs.backup.$(date -u +%Y%m%dT%H%M%SZ)"
  cp "$AGENT_DIR/agent.mjs" "$AGENT_BACKUP"
  chmod 600 "$AGENT_BACKUP"
fi

node - "$TMP" "$AGENT_DIR/agent.mjs" "$CONFIG_DIR/config.json" "$GH_TOKEN" <<'NODE'
const fs=require("fs");
const [,,src,dest,config,token]=process.argv;
const data=JSON.parse(fs.readFileSync(src,"utf8"));
if(!data.content||data.encoding!=="base64") throw new Error("Invalid agent download.");
const code=Buffer.from(data.content.replace(/\n/g,""),"base64");
if(!code.toString("utf8").includes("Safe allowlisted operations only")) throw new Error("Agent integrity check failed.");
fs.writeFileSync(dest,code,{mode:0o700});
fs.writeFileSync(config,JSON.stringify({repo:"coc338781-tech/hasa-bot-test-reports",token},null,2)+"\n",{mode:0o600});
NODE
chmod 700 "$AGENT_DIR/agent.mjs"
chmod 600 "$CONFIG_DIR/config.json"

echo "Checking agent syntax..."
if ! node --check "$AGENT_DIR/agent.mjs"; then
  echo "Updated agent syntax check failed."
  if [ -n "${AGENT_BACKUP:-}" ] && [ -f "$AGENT_BACKUP" ]; then
    cp "$AGENT_BACKUP" "$AGENT_DIR/agent.mjs"
    chmod 700 "$AGENT_DIR/agent.mjs"
    echo "Previous working agent restored."
  fi
  exit 1
fi
echo "Starting agent..."
if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock || true; fi
# Seed the heartbeat before launching so the watchdog does not mistake startup for a hang.
touch "$AGENT_DIR/heartbeat"
chmod 600 "$AGENT_DIR/heartbeat"
# Stop every stale copy of this exact agent, not only a possibly outdated PID file.
pkill -f '[n]ode .*/hasa-termux-agent/agent.mjs' 2>/dev/null || true
OLD_PID=""
[ -f "$AGENT_DIR/agent.pid" ] && OLD_PID="$(cat "$AGENT_DIR/agent.pid" 2>/dev/null || true)"
if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
  kill "$OLD_PID" 2>/dev/null || true
  sleep 1
fi
nohup node "$AGENT_DIR/agent.mjs" >> "$AGENT_DIR/agent.log" 2>&1 &
echo "$!" > "$AGENT_DIR/agent.pid"
sleep 2
if kill -0 "$(cat "$AGENT_DIR/agent.pid")" 2>/dev/null; then
  echo "Agent started successfully."
else
  echo "Agent did not stay running. Check $AGENT_DIR/agent.log"
  exit 1
fi

# A small watchdog restarts the agent if it exits or stops updating its heartbeat.
cat > "$AGENT_DIR/watchdog.sh" <<'WATCH'
#!/data/data/com.termux/files/usr/bin/bash
AGENT_DIR="$HOME/.local/share/hasa-termux-agent"
while true; do
  NOW="$(date +%s)"
  LAST="$(stat -c %Y "$AGENT_DIR/heartbeat" 2>/dev/null || echo 0)"
  if ! pgrep -f '[n]ode .*/hasa-termux-agent/agent.mjs' >/dev/null 2>&1 || [ "$LAST" -eq 0 ] || [ $((NOW - LAST)) -gt 300 ]; then
    pkill -f '[n]ode .*/hasa-termux-agent/agent.mjs' 2>/dev/null || true
    sleep 2
    nohup node "$AGENT_DIR/agent.mjs" >> "$AGENT_DIR/agent.log" 2>&1 &
    echo "$!" > "$AGENT_DIR/agent.pid"
  fi
  sleep 30
done
WATCH
chmod 700 "$AGENT_DIR/watchdog.sh"

BOOT_DIR="$HOME/.termux/boot"
mkdir -p "$BOOT_DIR"
cat > "$BOOT_DIR/start-hasa-agent" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock >/dev/null 2>&1 || true
AGENT_DIR="$HOME/.local/share/hasa-termux-agent"
if ! pgrep -f '[b]ash .*/hasa-termux-agent/watchdog.sh' >/dev/null 2>&1; then
  nohup bash "$AGENT_DIR/watchdog.sh" >> "$AGENT_DIR/watchdog.log" 2>&1 &
fi
if ! pgrep -f '[n]ode .*/hasa-termux-agent/agent.mjs' >/dev/null 2>&1; then
  nohup node "$AGENT_DIR/agent.mjs" >> "$AGENT_DIR/agent.log" 2>&1 &
  echo "$!" > "$AGENT_DIR/agent.pid"
fi
BOOT
chmod 700 "$BOOT_DIR/start-hasa-agent"

# Restart an older watchdog so the updated recovery loop takes effect now.
pkill -f '[b]ash .*/hasa-termux-agent/watchdog.sh' 2>/dev/null || true
nohup bash "$AGENT_DIR/watchdog.sh" >> "$AGENT_DIR/watchdog.log" 2>&1 &

echo "Agent log: $AGENT_DIR/agent.log"
echo "Token stored with mode 600; never share it."
echo "Boot script installed. Install and open the separate Termux:Boot app once to enable boot launch."
echo "For reliable background operation, set Android Settings > Apps > Termux > Battery > Unrestricted."
