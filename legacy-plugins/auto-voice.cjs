// Auto Voice Plugin for HASAA-MD
// Settings: 1.1 (ON), 1.2 (OFF)
// Uses TTS + ffmpeg for guaranteed WhatsApp-compatible voice notes

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const axios = require('axios');

module.exports = {
    name: 'auto-voice',

    async onMessage(sock, msg, config) {
        try {
            if (!config.autoVoice) return;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;
            if (msg.key.fromMe) return;

            const audioMsg = msg.message?.audioMessage;
            if (!audioMsg) return;
            if (audioMsg.ptt === false) return;

            // TTS text - customize this
            const ttsText = 'Hello, I received your voice message.';
            const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText)}&tl=en&client=tw-ob`;

            const tmpDir = '/tmp/hasa_voice';
            if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

            const timestamp = Date.now();
            const mp3File = path.join(tmpDir, `voice_${timestamp}.mp3`);
            const oggFile = path.join(tmpDir, `voice_${timestamp}.ogg`);

            // Download TTS mp3
            const response = await axios({
                url: ttsUrl,
                method: 'GET',
                responseType: 'arraybuffer',
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 15000
            });
            fs.writeFileSync(mp3File, Buffer.from(response.data));

            // Convert to OGG Opus (WhatsApp voice note format)
            await new Promise((resolve, reject) => {
                exec(`ffmpeg -y -i "${mp3File}" -c:a libopus -b:a 48k -ar 48000 -ac 1 "${oggFile}"`,
                    { timeout: 20000 },
                    (err) => err ? reject(err) : resolve());
            });

            if (!fs.existsSync(oggFile)) {
                throw new Error('ffmpeg conversion failed');
            }

            // Send as WhatsApp voice note
            await sock.sendMessage(from, {
                audio: fs.readFileSync(oggFile),
                mimetype: 'audio/ogg; codecs=opus',
                ptt: true
            }, { quoted: msg });

            // Cleanup temp files
            try { fs.unlinkSync(mp3File); } catch {}
            try { fs.unlinkSync(oggFile); } catch {}

        } catch (e) {
            console.error('Auto Voice error:', e.message);
        }
    }
};
