#!/usr/bin/env bash
# Read-only Oracle diagnostics. Never restarts or edits services or reads auth/session files.
set -Eeuo pipefail
APP=/home/opc/Hasa_2_bot
cd "$APP"
section() { printf '\n===== %s =====\n' "$1"; }
redact() { sed -E -e 's/[0-9]{8,}/[REDACTED_NUMBER]/g' -e 's#https?://[^ ]+#URL_REDACTED#g' -e 's/(AIza[0-9A-Za-z_-]{20,})/[REDACTED_API_KEY]/g' -e 's/(Bearer )[A-Za-z0-9._-]+/\1[REDACTED]/g'; }
section "IDENTITY"
printf 'Host: '; hostname
printf 'Date: '; date -Is
printf 'Commit: '; git rev-parse --short HEAD 2>/dev/null || true
section "HOST HEALTH"
uptime || true
free -h || true
df -h "$APP" "$HOME" 2>/dev/null || df -h || true
printf 'Load: '; cat /proc/loadavg 2>/dev/null || true
printf 'OS: '; grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"' || true
printf 'Node: '; node --version 2>/dev/null || true
printf 'npm: '; npm --version 2>/dev/null || true
section "PM2 PROCESS"
pm2 jlist 2>/dev/null | node --input-type=commonjs -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
 try { const p=JSON.parse(s).find(x=>x.name==="hasa2");
 if(!p){console.log("hasa2: NOT FOUND");process.exitCode=2;return;}
 const e=p.pm2_env||{},m=p.monit||{};
 console.log("name: "+p.name); console.log("status: "+(e.status||"unknown"));
 console.log("restart_count: "+(e.restart_time??"unknown"));
 console.log("uptime_seconds: "+(e.pm_uptime?Math.floor((Date.now()-e.pm_uptime)/1000):"unknown"));
 console.log("memory_mb: "+(m.memory==null?"unknown":(m.memory/1048576).toFixed(1)));
 console.log("cpu_percent: "+(m.cpu??"unknown"));
 console.log("exit_code: "+(e.exit_code??"unknown"));
 console.log("unstable_restarts: "+(e.unstable_restarts??"unknown"));
 } catch(e){console.log("Could not parse PM2 state: "+e.message);process.exitCode=1}
});' || true
section "PM2 ERROR LOGS"
if [ -f "$HOME/.pm2/logs/hasa2-error.log" ]; then
 tail -n 300 "$HOME/.pm2/logs/hasa2-error.log" | grep -Ei 'error|warn|exception|failed|timeout|401|403|408|429|disconnect|reconnect|uncaught|rejection|killed|heap|memory|restart|closed|logout' | grep -Eiv 'message|chat|jid|from|to|body|text|payload|quoted|contact|media|@s\.whatsapp\.net|@g\.us' | tail -n 80 | redact || true
else echo "No PM2 error log file."; fi
section "PM2 OUTPUT LOGS"
if [ -f "$HOME/.pm2/logs/hasa2-out.log" ]; then
 tail -n 400 "$HOME/.pm2/logs/hasa2-out.log" | grep -Ei 'connected|connection|close|disconnect|reconnect|restart|ready|fatal|uncaught|unhandled|error|warn|shutdown|signal' | grep -Eiv 'message|chat|jid|from|to|body|text|payload|quoted|contact|media|@s\.whatsapp\.net|@g\.us' | tail -n 60 | redact || true
else echo "No PM2 output log file."; fi
section "PM2 DAEMON LOGS"
if [ -f "$HOME/.pm2/pm2.log" ]; then
 tail -n 300 "$HOME/.pm2/pm2.log" | grep -Ei 'error|warn|exception|exit|restart|online|stopped|errored|launch|kill|memory' | tail -n 60 | redact || true
else echo "No PM2 daemon log file."; fi
section "KERNEL OOM EVENTS (24 HOURS)"
if command -v journalctl >/dev/null 2>&1; then
 journalctl -k --since "24 hours ago" --no-pager 2>/dev/null | grep -Ei 'out of memory|oom-kill|killed process|memory cgroup out of memory' | tail -n 40 | redact || echo "No matching kernel OOM events or journal access unavailable."
else echo "journalctl unavailable."; fi
section "SYSTEMD USER SERVICES"
systemctl --user --no-pager --failed 2>&1 | head -n 30 || true
section "LOCAL RUNTIME DEPENDENCIES"
printf 'yt-dlp: '; yt-dlp --version 2>&1 | head -n 1 || true
printf 'ffmpeg: '; ffmpeg -version 2>&1 | head -n 1 || true
section "DISK PRESSURE"
du -sh "$APP/downloads" "$APP/tmp" 2>/dev/null || true
section "END"
echo "Read-only completed. No PM2 restart, config edit, or auth/session access."
