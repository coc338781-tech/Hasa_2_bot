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
- HASA Video Studio (reply-based FFmpeg editing, multi-operation jobs, Sinhala text captions, quality/speed/trim/audio/filters/aspect ratios/GIF/audio extraction).
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
pkg install ffmpeg fontconfig -y
python -m pip install -U yt-dlp
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
- `.dl url`, `.fb url`
- `.vedit help` (reply to a video); combine operations with ` | `, e.g. `.vedit quality 1080 | speed 0.8 | caption Sinhala text | filter cinematic`
- `.vedit trim 00:05 00:25 | mute | format 9:16`, `.vedit music <HTTPS audio URL> | musicvolume 25`, `.vedit pitch 1.2 | fps 30`, `.vedit sharpen 1 | denoise 2`, `.vedit fadein 1 | fadeout 1`, `.vedit reverse`, `.vedit thumbnail 00:05`, `.vedit auto`, `.vedit subtitle auto`, `.vedit voiceover සිංහල වාක්‍යය`, `.vedit gif`, `.vedit extractaudio`
- `.subbot phone-number`, `.subcheck`, `.stopsubbot`, `.restartsubbot`, `.delsubbot`, `.helpsubbot`
- `.personalhelp`, `.contact <name or number>`, `.today`, `.sendto <name or number> | <message>`, `.smartreply on|off`

## Important notes
- Subbot sessions are separate under `subbot_sessions/`; deleting a Subbot removes only that Subbot's own session folder.
- Do not upload `auth_info/`, `subbot_sessions/`, `.env`, `config.json`, or API keys.
- Keep this repository in a new folder such as `~/Hasa_2_bot`; do not clone over your old bot.
- Legacy source files are kept under `legacy-plugins/` for reference and are not loaded directly.
- Syntax/CI checks do not guarantee WhatsApp will accept a session or that external download/AI providers will always work. Real connection testing must be done after installation with your own WhatsApp account.
- Atlas-MD code has not been copied wholesale; features are being ported selectively to avoid mixing incompatible Baileys APIs or QR login paths.

## HASA Video Studio

The Video Studio requires system `ffmpeg` and `ffprobe` binaries. `GEMINI_API_KEY` enables `.vedit auto` (Gemini visual recommendations) and `.vedit voiceover <text>` (Sinhala voice-over via Gemini 3.8 Flash TTS). Gemini visual auto-edit tries Gemini 3.8 Flash first, then falls back to Gemini 3.6 Flash and Gemini 3.5 Flash-Lite when the primary model is temporarily unavailable. TTS uses the Gemini Developer API Interactions endpoint and returns a WAV file; Sinhala is supported with automatic language detection. Optional `videoStudio.ttsStyle` controls narration delivery. On Ubuntu/Debian install them with `sudo apt-get update && sudo apt-get install -y ffmpeg fonts-noto-core`. The Noto Sinhala font is normally at `/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf`; verify the path and set `videoStudio.fontFile` in `config.json`. On Termux, install `ffmpeg` and place a licensed Sinhala Unicode TTF font in a readable local path. Set that exact path in the config. Reply to a WhatsApp video with `.vedit help`; chain multiple operations with ` | ` so the bot performs one final encode. Jobs are queued and temporary media is removed after processing. The implementation supports local FFmpeg editing, optional Gemini visual auto-edit and Sinhala voice-over, and optional local Whisper.cpp Sinhala subtitles. Background removal and face detection are not included.


The CI suite installs FFmpeg and Whisper.cpp, builds the multilingual base model, and includes real integration checks for chained edits, trimming, music mixing, voice-over mixing, and WhatsApp-compatible animated MP4/GIF export. Live Gemini visual-edit, Sinhala TTS, and local Whisper.cpp Sinhala SRT subtitle smoke tests run on the generated sample video. Background removal and face detection are not included.

## Optional AI editing and Sinhala auto-subtitles

- `.vedit auto` creates a small 3×3 contact sheet from the video and sends those preview frames to Gemini 3.8 Flash for a conservative visual edit plan. It requires `GEMINI_API_KEY`. This is an explicit cloud-processing command; do not use it for private footage unless you are comfortable sending preview frames to Google.
- `.vedit voiceover <Sinhala text>` generates a Sinhala WAV voice-over with Gemini 3.8 Flash TTS and mixes it with the video audio. It requires `GEMINI_API_KEY`; generated speech is processed by Google.
- `.vedit subtitle auto` runs local Whisper.cpp speech recognition in Sinhala and burns the generated SRT captions into the video. It does not send the video/audio to Gemini.
- Low-memory VPS setting: FFmpeg filter/encoder threads and Whisper threads default to 1; only one video job runs at a time. Video Studio rejects source dimensions above 1920px on either side. Reverse is limited to 15 seconds and downscales to 640×360 at 15 FPS before buffering, to avoid large RAM spikes.
- For Sinhala auto-subtitles on a low-memory VPS, build Whisper.cpp and download the multilingual `tiny` model (lower RAM use; `base` may improve recognition but needs more memory):
  ```sh
  sudo apt-get install -y cmake build-essential
  git clone https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp
  cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build -DWHISPER_BUILD_TESTS=OFF
  cmake --build /opt/whisper.cpp/build -j1
  bash /opt/whisper.cpp/models/download-ggml-model.sh tiny
  ```
- Set `videoStudio.whisperBinary` to `/opt/whisper.cpp/build/bin/whisper-cli` and `videoStudio.whisperModel` to `/opt/whisper.cpp/models/ggml-tiny.bin` in `config.json`. The default language is Sinhala (`si`) and Whisper is limited to two CPU threads by default.
