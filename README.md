# Hasa_2_bot

A WhatsApp MD bot with pairing-code login, modular plugins, owner controls, AI assistance, media tools and guarded Oracle deployment.

## Features
- Pairing-code login only; QR output is disabled.
- Reconnect handling with exponential backoff; auth folders are never automatically deleted.
- Modular plugin loader that isolates plugin load/runtime errors.
- Premium numbered main menu, full command list and owner-only numbered settings panel.
- Logo, bot name, footer and alive-message customization.
- Auto status seen and optional status reactions.
- Anti-delete for supported text and media messages; configurable inbox forwarding.
- View-once image/video handling where supported by the WhatsApp message payload.
- Gemini AI text chat plus image analysis and voice-message transcription/analysis when an API key is configured.
- Group commands: tagall, hidetag, promote, demote, kick and groupinfo (admin checks included).
- Video and MP3 downloader for supported public URLs via yt-dlp (.dl, .fb, .song and .mp3).
- Sticker maker for images and short videos; video-to-audio and sticker-to-image conversion via FFmpeg.
- Configurable auto replies with add/replace/list/remove/reset commands.
- Optional auto voice reply and composing presence.
- Pairing-code Subbot with separate per-owner session storage.
- System monitor with OS, CPU, RAM, disk, Node.js, Baileys, plugin count and uptime.
- PM2 restart/recovery on Oracle with guarded deployment and rollback.

## Commands
- General: `.menu`, `.list`, `.ping`, `.alive`, `.uptime`, `.system`, `.ram`
- AI: `.ai <question>`; reply to an image or voice note with `.ai <question>` (or `.ai` for a default description/transcription).
- Downloads: `.dl <video-url>`, `.fb <facebook-url>`, `.song <url>`, `.mp3 <url>`
- Media: reply to an image/video with `.sticker`; reply to a video/audio with `.toaudio`; reply to a sticker with `.toimage`.
- Group: `.tagall`, `.hidetag`, `.promote @user`, `.demote @user`, `.kick @user`, `.groupinfo`
- Auto reply: `.addreply word-reply`, `.replacereply word-reply`, `.getreply`, `.removereply word`, `.resetreply`
- Owner settings: `.settings`, `.autoreply on|off`, `.statusseen on|off`, `.statusreact green|random|off`, `.antidelete on|off`, `.viewonce on|off`, `.aichat on|off`, `.groupcmd on|off`, `.composing on|off`, `.autovoice on|off`
- Appearance (owner): `.apply`, `set 1.1 Bot Name`, `set 1.3 Footer`, `set 1.4 Alive Message`
- Subbot: `.subbot <phone-number>`, `.subcheck`, `.getsubbot`, `.stopsubbot`, `.restartsubbot`, `.delsubbot`, `.helpsubbot`
- Diagnostics: `.botcheck` (owner-only).

## Requirements
- Node.js 20 or newer.
- FFmpeg for sticker and media conversion.
- yt-dlp for supported public video downloads.
- A Gemini API key for AI features.

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

For AI, add `GEMINI_API_KEY=your_key` to `.env` and set `aiChat` to true in config.json (or use the owner settings command after startup).

## Safety and privacy
- Owner-only commands check the configured owner number.
- Private credentials, `auth_info/`, `subbot_sessions/`, `.env`, and `config.json` must never be committed.
- AI media is sent to Google's Gemini API only when the user invokes `.ai` on that image/audio. The bot does not upload ordinary chat messages to the AI service.
- Downloads and conversions are limited in size and temporary files are removed after processing.
- Group management commands require admin permissions; the bot must also be an admin for promote/demote/kick actions.
- Do not use view-once or anti-delete features to redistribute other people's private content without their consent.

## Oracle deployment
- GitHub Actions runs syntax, plugin-load and test checks before deployment.
- Oracle deployment is enabled only when the repository variable `ORACLE_DEPLOY_ENABLED` is set to `true`.
- Deployments run only from `assistant-workflow`; feature branches run checks without restarting the live bot.
- The restricted deploy script validates the application and rolls back the release if deployment checks fail.

## Development checks
```sh
npm run check
npm run test:decrypt-retry
npm run test:system-info
``

Checks do not guarantee WhatsApp will accept a session or that external AI/download providers will always be available. Real connection and provider tests must be done after deployment with the owner's own WhatsApp account.
