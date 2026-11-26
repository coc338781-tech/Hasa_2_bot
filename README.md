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
- Video downloader for supported public URLs via yt-dlp (.dl and .fb).\n- HASA Video Studio (reply-based FFmpeg editing, multi-operation jobs, Sinhala text captions, quality/speed/trim/audio/filters/aspect ratios/GIF/audio extraction).
- Optional auto voice reply and composing presence.
- Owner-only personal WhatsApp assistant: contact lookup, daily incoming-message counts, and explicit message sending.
- Optional context-aware AI Smart Reply for private one-to-one chats; disabled by default.
- Pairing-code Subbot with separate per-owner session storage.

## Termux installation
```sh
pkg update -y && pkg upgrade -y
pkg install nodejs-lts git ffmpeg python -y
git clone https://github.com/coc338781-tech/Hasa_2_bot.git
cd Hasa_2_bot
npm install
pkg install ffmpeg ffprobe font-noto-sans-sinhala -y\npython -m pip install -U yt-dlp
cp config.example.json config.json
nano config.json
npm run check
npm start
```

Set the `owner` number in config.json to your WhatsApp number with country code, digits only. The main bot asks for the WhatsApp number on first pairing; you can alternatively set `BOT_PHONE_NUMBER` in a private `.env` file. The pairing code is shown in the terminal. On WhatsApp: Linked devices -> Link a device -> Link with phone number instead.

For AI, add `GEMINI_API_KEY=your_key` to `.env` and set `aiChat` to true in config.json. Smart Reply has a separate `smartReply` switch (default false); incoming private-chat text and up to 8 recent text turns are sent to Gemini to generate a reply. No media or contact list is sent. Daily statistics store sender JIDs and counts locally in a permission-restricted file.

## Commands
- `.menu`, `.ping`, `.alive`, `.uptime`
- `.autoreply on|off`
- `.addreply word-reply`, `.replaceeply word-reply`, `.getreply`, `.removereply word`, `.resetreply`
- `.tagall`, `.hidetag`, `.promote @user`, `.demote @user`, `.kick @user`, `.groupinfo`
- `.ai question`, `.hack` (owner-only harmless prank simulation)
- `.dl url`, `.fb url`\n- `.vedit help` (reply to a video), `.vedit quality 1080 | speed 0.8 | caption Sinhala text`, `.vedit trim 00:05 00:25 | mute | format 9:16`, `.vedit music <HTTPS audio URL>`, `.vedit filter cinematic`, `.vedit gif`, `.vedit extractaudio`
- `.subbot phone-number`, `.subcheck`, `.stopsubbot`, `.restartsubbot`, `.delsubbot`, `.helpsubbot`
- `.personalhelp`, `.contact <name or number>`, `.today`, `.sendto <name or number> | <message>`, `.smartreply on|off`

## Important notes
- Subbot sessions are separate under `subbot_sessions/`; deleting a Subbot removes only that Subbot's own session folder.
- Do not upload `auth_info/`, `subbot_sessions/`, `.env`, `config.json`, or API keys.
- Keep this repository in a new folder such as `~/Hasa_2_bot`; do not clone over your old bot.
- Legacy source files are kept under `legacy-plugins/` for reference and are not loaded directly.
- Syntax/CI checks do not guarantee WhatsApp will accept a session or that external download/AI providers will always work. Real connection testing must be done after installation with your own WhatsApp account.
- Atlas-MD code has not been copied wholesale; features are being ported selectively to avoid mixing incompatible Baileys APIs or QR login paths.
\n## HASA Video Studio\n\nThe Video Studio requires system `ffmpeg` and `ffprobe` binaries. Install a Sinhala Unicode font and set `videoStudio.fontFile` in `config.json` to its actual font path. Reply to a WhatsApp video with `.vedit help`; chain multiple operations with ` | ` so the bot performs one final encode. Jobs are queued and temporary media is removed after processing. The initial implementation supports local FFmpeg operations; cloud AI auto-edit, speech-to-text subtitles, background removal, and face detection require separately configured AI/model services and are not claimed as active until integrated and tested.\n