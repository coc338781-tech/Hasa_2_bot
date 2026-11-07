# Hasa_2_bot

A separate WhatsApp MD bot project. This repository is independent from `HASA-MD_next-Bot`.

## Features in this initial build
- Pairing-code login only (no QR output or QR endpoint)
- Reconnect handling with backoff; pairing code requested once per socket generation
- Plugin loader
- Auto reply, status auto-seen, anti-delete message cache, view-once handling
- Group admin commands
- Optional AI chat (Gemini API key)
- Optional downloader integration via yt-dlp executable

## Termux setup
```sh
pkg update -y && pkg upgrade -y
pkg install nodejs-lts git ffmpeg python -y
git clone https://github.com/coc338781-tech/Hasa_2_bot.git
cd Hasa_2_bot
npm install
cp config.example.json config.json
nano config.json
npm start
```

Enter the WhatsApp number with country code when prompted (digits only, e.g. 9477xxxxxxx). The pairing code is printed in the Termux terminal. On WhatsApp: Linked devices -> Link a device -> Link with phone number instead.

## Important
- Never upload `auth_info/`, `.env`, or API keys.
- Keep this folder separate from your existing bot folder.
- This is the first clean foundation. Porting every legacy plugin and enabling provider-dependent integrations is tracked separately; do not assume every old plugin is already migrated.
