#!/usr/bin/env bash
# Read-only Oracle access capability audit. Does not edit files, services, PM2, or WhatsApp auth.
set -Eeuo pipefail
APP=/home/opc/Hasa_2_bot
section(){ printf '\n===== %s =====\n' "$1"; }
check_path(){
  local p="$1"
  if [ -e "$p" ]; then
    printf '%s | exists=yes | read=%s | write=%s | execute=%s\n' "$p" \
      "$([ -r "$p" ] && echo yes || echo no)" \
      "$([ -w "$p" ] && echo yes || echo no)" \
      "$([ -x "$p" ] && echo yes || echo no)"
  else printf '%s | exists=no\n' "$p"; fi
}
section "IDENTITY AND PRIVILEGES"
id
printf 'groups: '; id -nG
printf 'sudo_available: '; command -v sudo || true
if command -v sudo >/dev/null 2>&1; then
  echo "sudo_noninteractive_permissions:"
  sudo -n -l 2>&1 | sed -E 's/(NOPASSWD:).*/\1 [COMMAND LIST REDACTED]/' | head -n 25 || true
fi
section "HOST AND RUNTIME"
printf 'hostname: '; hostname
printf 'os: '; . /etc/os-release 2>/dev/null && printf '%s\n' "${PRETTY_NAME:-unknown}" || true
printf 'kernel: '; uname -sr
printf 'node: '; node --version 2>/dev/null || echo unavailable
printf 'npm: '; npm --version 2>/dev/null || echo unavailable
printf 'git: '; git --version 2>/dev/null || echo unavailable
printf 'pm2: '; pm2 --version 2>/dev/null || echo unavailable
section "PATH PERMISSIONS (NO WRITE TESTS)"
for p in "$HOME" "$APP" "$APP/plugins" "$APP/auth_info" "$APP/subbot_sessions" "$HOME/.pm2" /home/opc/bin /etc/systemd/system /usr/local/bin /var/log; do check_path "$p"; done
section "PM2 CAPABILITY"
if command -v pm2 >/dev/null 2>&1; then
  pm2 jlist 2>/dev/null | node -e '
  let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
    try { for(const p of JSON.parse(s)){const e=p.pm2_env||{};const m=p.monit||{};
      console.log("app="+p.name+" status="+(e.status||"unknown")+" restarts="+(e.restart_time??"?")+" memory_mb="+(m.memory==null?"?":Math.round(m.memory/1048576)));
    }} catch { console.log("PM2 JSON unavailable"); }
  });' || true
fi
section "SERVICE AND PROCESS TOOLS"
for c in systemctl journalctl crontab ss lsof; do printf '%s: ' "$c"; command -v "$c" || echo unavailable; done
if command -v systemctl >/dev/null 2>&1; then
  printf 'systemd_user_manager: '; systemctl --user is-system-running 2>&1 | head -n 1 || true
  printf 'systemd_system_manager: '; systemctl is-system-running 2>&1 | head -n 1 || true
fi
section "GIT WORKTREE (NAMES ONLY)"
if [ -d "$APP/.git" ]; then
  git -C "$APP" rev-parse --short HEAD
  git -C "$APP" status --short
else echo "Application git checkout missing"; fi
section "NETWORK TOOL AVAILABILITY"
for c in curl wget ssh; do printf '%s: ' "$c"; command -v "$c" || echo unavailable; done
section "END"
echo "Read-only audit complete. No credentials, WhatsApp session contents, or environment values were read."
