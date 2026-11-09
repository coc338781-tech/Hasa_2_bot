#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

echo "Hasa Termux Agent - one-time secure setup"
command -v node >/dev/null || { echo "Node.js missing. Run: pkg install nodejs-lts curl -y"; exit 1; }
command -v curl >/dev/null || { echo "curl missing. Run: pkg install curl -y"; exit 1; }

read -rsp "Paste a fine-grained GitHub token (only hasa-bot-test-reports: Contents read/write): " GH_TOKEN < /dev/tty
echo
[ -n "$GH_TOKEN" ] || { echo "No token supplied."; exit 1; }

API="https://api.github.com/repos/coc338781-tech/hasa-bot-test-reports/contents/termux-agent/agent.mjs?ref=main"
TMP="$(mktemp)"
trap 'rm -f "$TMP"; unset GH_TOKEN' EXIT
if ! curl -fsS -H "Authorization: Bearer $GH_TOKEN" -H "Accept: application/vnd.github+json" "$API" -o "$TMP"; then
  echo "Could not access the private agent file. Check token repository access and Contents: Read."
  exit 1
fi

AGENT_DIR="$HOME/.local/share/hasa-termux-agent"
CONFIG_DIR="$HOME/.config/hasa-termux-agent"
mkdir -p "$AGENT_DIR" "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR" "$AGENT_DIR"

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
node --check "$AGENT_DIR/agent.mjs"
echo "Starting agent..."
if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock || true; fi
nohup node "$AGENT_DIR/agent.mjs" >> "$AGENT_DIR/agent.log" 2>&1 &
echo "$!" > "$AGENT_DIR/agent.pid"
sleep 2
if kill -0 "$(cat "$AGENT_DIR/agent.pid")" 2>/dev/null; then
  echo "Agent started successfully."
else
  echo "Agent did not stay running. Check $AGENT_DIR/agent.log"
  exit 1
fi

echo "Agent log: $AGENT_DIR/agent.log"
echo "Token stored with mode 600; never share it."
echo "For reliable background operation, set Android Settings > Apps > Termux > Battery > Unrestricted."
