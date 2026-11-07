# Hasa_2_bot

A separate WhatsApp MD bot project. It does not overwrite or share the existing bot's session folder.

## Current features
- Pairing-code login only; QR output is disabled.
- Reconnect handling with exponential backoff; auth folders are never automatically deleted.
- Modular plugin loader that isolates plugin load/runtime errors.
- Auto status seen, anti-delete (text and media forwarding where supported), and view-once media handling.
- Configurable auto replies with add/replace/list/remove/reset commands.
- Group commands: tagall, hidetag, promote, demote, kick, groupinfo (admin checks included).
- AI chat using Gemini when an API key is configured.
- Video downloader for supported public URLs via yt-dlp (.dl and .fb).
- Optional auto voice reply and composing presence.
- Pairing-code Subbot with separate per-owner session storage.

## Termux installation
```sh
pkg update -y && pkg upgrade -y
pkg install nodejs-lts git ffmpeg python -y
git clone https://github.com/coc338781-tech/Hasa_2_bot.git
cd Hasa_2_bot
npm install
python -m pip install -U yt-dlp
cp config.example.json config.json
nano config.json
npm run check
npm start
```

Set the `owner` number in config.json to your WhatsApp number with country code, digits only. The main bot asks for the WhatsApp number on first pairing; you can alternatively set `BOT_PHONE_NUMBER` in a private `.env` file. The pairing code is shown in the terminal. On WhatsApp: Linked devices -> Link a device -> Link with phone number instead.

For AI, add `GEMINI_API_KEY=your_key` to `.env` and set `aiChat` to true in config.json.

## Commands
- `.menu`, `.ping`, `.alive`, `.uptime`
- `.autoreply on|off`
- `.addreply word-reply`, `.replaceeply word-reply`, `.getreply`, `.removereply word`, `.resetreply`
- `.tagall`, `.hidetag`, `.promote @user`, `.demote @user`, `.kick @user`, `.groupinfo`
- `.ai question`
- `.dl url`, `.fb url`
- `.subbot phone-number`, `.subcheck`, `.stopsubbot`, `.restartsubbot`, `.delsubbot`, `.helpsubbot`

## Important notes
- Subbot sessions are separate under `subbot_sessions/`; deleting a Subbot removes only that Subbot's own session folder.
- Do not upload `auth_info/`, `subbot_sessions/`, `.env`, `config.json`, or API keys.
- Keep this repository in a new folder such as `~/Hasa_2_bot`; do not clone over your old bot.
- Legacy source files are kept under `legacy-plugins/` for reference and are not loaded directly.
- Syntax/CI checks do not guarantee WhatsApp will accept a session or that external download/AI providers will always work. Real connection testing must be done after installation with your own WhatsApp account.
- Atlas-MD code has not been copied wholesale; features are being ported selectively to avoid mixing incompatible Baileys APIs or QR login paths.
