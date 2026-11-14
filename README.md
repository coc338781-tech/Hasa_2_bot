# Hasa_2_bot

A separate WhatsApp MD bot project. It does not overwrite or share the existing bot's session folder.

## Current features
- Pairing-code login only; QR output is disabled.
- Reconnect handling with exponential backoff; auth folders are never automatically deleted.
- Modular plugin loader that isolates plugin load/runtime errors.
- Auto status seen, anti-delete (text and media forwarding where supported), and view-once media handling.
- Configurable auto replies with add/replace/list/remove/reset commands.
- Group commands: tagall, hidetag, promote, demote, kick, groupinfo, anti-link moderation, and member warnings (admin checks included).
- AI chat using Gemini when an API key is configured, including image questions and voice transcription.
- Video downloader for supported public URLs via yt-dlp (.dl and .fb), with disk-backed WhatsApp media delivery and a 200 MiB video cap.
- 18+ self-attested public video browser (.xvdl): Pornhub public category/search listings and xHamster public video/creator-page listings; owner bypasses the bot's age prompt.
- Media tools: create static/animated stickers (.sticker / .s), extract audio from video (.toaudio), compress video (.compress), and convert photos to PDF (.topdf).
- AI and utility tools: live web search (.search), text-to-speech (.tts), PDF text extraction/summarization (.pdf), image OCR (.ocr), QR codes (.qr), and downloadable contact cards (.vcard).
- Owner tools: Gemini/Groq usage counters (.aiusage) and persistent scheduled private messages (.schedule / .schedules / .cancelschedule).
- Optional auto voice reply and composing presence.
- Owner-only personal WhatsApp assistant: contact verification, daily incoming-message counts, and explicit message sending.
- Optional context-aware AI Smart Reply for private one-to-one chats; disabled by default and controlled with `.smartreply on|off`.
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

For AI text, image questions, and voice transcription, add `GEMINI_API_KEY=your_key` to `.env` and set `aiChat` to true in config.json. AI Smart Reply has its own `smartReply` switch (default false); it sends incoming private-chat text and up to 8 recent text turns to the configured Gemini API. No media or contact list is sent. Daily message statistics store only sender JIDs and counts locally in a permission-restricted file. AI media input is limited to 15 MB. OCR requires AI Chat and Gemini API access; PDF text extraction may use `pdftotext` when available. Text-to-speech and QR generation use external web services. Scheduled messages are stored in `data/scheduled-messages.json` and restored after reconnect; keep the server clock accurate. Sticker, audio extraction, and compression tools require FFmpeg on the server.

## Commands
- `.menu`, `.ping`, `.alive`, `.uptime`
- `.autoreply on|off`
- `.addreply word-reply`, `.replaceeply word-reply`, `.getreply`, `.removereply word`, `.resetreply`
- `.tagall`, `.hidetag`, `.promote @user`, `.demote @user`, `.kick @user`, `.groupinfo`, `.antilink on/off`, `.warn @user [reason]`, `.warnings @user`, `.resetwarn @user`
- `.ai question`, reply to an image with `.ai describe this`, `.transcribe` (reply to voice/audio), `.hack` (owner-only harmless prank simulation)
- Owner personal assistant: `.personalhelp`, `.contact <name or number>`, `.today`, `.sendto <name or number> | <message>`, `.smartreply on|off`
- `.sticker` / `.s` (reply to image/video), `.toaudio` (reply to video), `.compress` (reply to video), `.topdf` (reply to photo)
- `.search query`, `.tts [si|en|ta] text`, `.pdf` (reply to PDF), `.ocr` (reply to photo), `.qr text`, `.vcard Name | Number | Company`
- Owner: `.aiusage`, `.schedule 10m 9477XXXXXXX | Message`, `.schedules`, `.cancelschedule ID
- `.dl url`, `.fb url`, `.xvdl` (18+ public video browser)
- `.subbot phone-number`, `.subcheck`, `.stopsubbot`, `.restartsubbot`, `.delsubbot`, `.helpsubbot`

## Important notes
- Subbot sessions are separate under `subbot_sessions/`; deleting a Subbot removes only that Subbot's own session folder.
- Do not upload `auth_info/`, `subbot_sessions/`, `.env`, `config.json`, or API keys.
- Keep this repository in a new folder such as `~/Hasa_2_bot`; do not clone over your old bot.
- Legacy source files are kept under `legacy-plugins/` for reference and are not loaded directly.
- Syntax/CI checks do not guarantee WhatsApp will accept a session or that external download/AI providers will always work. Real connection testing must be done after installation with your own WhatsApp account.
- Atlas-MD code has not been copied wholesale; features are being ported selectively to avoid mixing incompatible Baileys APIs or QR login paths.

## Oracle deployment
- GitHub Actions runs the test suite before checking the restricted Oracle deployment connection.
- Oracle deployment is enabled only when the repository variable `ORACLE_DEPLOY_ENABLED` is set to `true`.
- The restricted deploy script validates the application and rolls back the release if deployment checks fail.
