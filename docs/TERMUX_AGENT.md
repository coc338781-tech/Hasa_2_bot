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

Termux-local diagnostics:
- `health`, `pm2-status`, `bot-check`, `git-status`, `pkg-list`
- `file-list`, `file-read`
- `file-write` and `file-trash` only with explicit approval; trash is reversible
- `pm2-restart` only for the known `hasa2` app and explicit approval

Oracle bridge (uses the existing Termux SSH alias `oracle`):
- `oracle-health`, `oracle-pm2-status`, `oracle-log-summary`
- `oracle-bot-check`, `oracle-git-status`, `oracle-git-fetch`, `oracle-subbot-status`
- `oracle-file-list`, `oracle-file-read`
- `oracle-file-write` and `oracle-file-trash` require `approved:true`; writes make a backup and trash is reversible
- `oracle-git-pull` and `oracle-pm2-restart` require `approved:true`; pull aborts if the working tree is dirty and runs the bot check afterward

Remote file access is limited to paths inside `/home/opc/Hasa_2_bot`. The agent blocks credentials, `.env`, `config.json`, WhatsApp auth, Subbot sessions, downloads, `.git`, and `node_modules`. It does not expose arbitrary shell execution, read private keys, or reboot the server. The SSH alias must already work from Termux using `ssh oracle`.

To upgrade an existing installation after an agent release, run the same installer command again. It reuses the token stored in the protected config file and replaces the agent after checking its syntax.

## Background operation

For reliable background operation, set Android Settings → Apps → Termux → Battery → Unrestricted. The agent log is at `~/.local/share/hasa-termux-agent/agent.log`. The installer also creates a Termux:Boot launch script; automatic startup still requires installing and opening the separate Termux:Boot app once and Android allowing Termux to run in the background.

## Security

Never share the fine-grained token. Revoke it from GitHub settings if the phone is lost or the token may have leaked. A token expiry will stop remote control until it is renewed.
