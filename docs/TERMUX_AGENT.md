# Termux Agent Setup

This agent connects Termux to the private `coc338781-tech/hasa-bot-test-reports` control repository. It does not expose an arbitrary shell. It accepts only fixed operations and protects credential/session directories.

## One-time requirement

Create a **fine-grained personal access token** on GitHub:
1. Open GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens.
2. Choose **Only select repositories** and select `hasa-bot-test-reports`.
3. Grant **Contents: Read and write**. Metadata read is automatic.
4. Copy the token once. Do not send it in ChatGPT or paste it into a public repository.

## Install in Termux

Install Node.js and curl if they are missing:

```sh
pkg install nodejs-lts curl -y
```

Then run the setup script:

```sh
curl -fsSL https://raw.githubusercontent.com/coc338781-tech/Hasa_2_bot/main/scripts/termux-agent-setup.sh | bash
```

The script prompts for the token without echoing it, downloads the agent from the private repository, stores the token in `~/.config/hasa-termux-agent/config.json` with mode 600, checks syntax, and starts the agent.

## Supported operations

- `health`, `pm2-status`, `bot-check`, `git-status`, `pkg-list`
- `file-list`, `file-read`
- `file-write` and `file-trash` only with explicit approval; trash is reversible
- `pm2-restart` only for a named known app and explicit approval

It does not read `.env`, SSH keys, API tokens, WhatsApp auth/session folders, Subbot sessions, `.git`, or `node_modules`. It does not run arbitrary shell commands, access Android-private app data, or bypass Android/root permissions.

## Background operation

For reliable background operation, set Android Settings → Apps → Termux → Battery → Unrestricted. The agent log is at `~/.local/share/hasa-termux-agent/agent.log`. If Android stops Termux, open Termux and start the agent again; automatic boot startup requires the separate Termux:Boot app and has not been enabled by this installer.

## Security

Never share the fine-grained token. Revoke it from GitHub settings if the phone is lost or the token may have leaked. A token expiry will stop remote control until it is renewed.
