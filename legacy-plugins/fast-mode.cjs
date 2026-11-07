// Fast Mode Plugin for HASAA-MD
// Settings: 16.1 (ON), 16.2 (OFF)
// Handles NEW commands that index.js doesn't have

const os = require('os');

module.exports = {
    name: 'fast-mode',

    async onMessage(sock, msg, config) {
        try {
            if (!config.fastMode) return;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const body = (msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '').trim();

            if (!body.startsWith('.')) return;

            const cmd = body.toLowerCase().split(' ')[0];

            // Only handle NEW commands not in index.js
            if (cmd === '.uptime') {
                const up = process.uptime();
                const h = Math.floor(up / 3600);
                const m = Math.floor((up % 3600) / 60);
                const s = Math.floor(up % 60);
                await sock.sendMessage(from, {
                    text: `⏳ *Uptime:* \`${h}h ${m}m ${s}s\`\n⚡ _Fast Mode_`
                }, { quoted: msg });
                return;
            }

            if (cmd === '.fastmode') {
                await sock.sendMessage(from, {
                    text: `⚡ *Fast Mode:* ${config.fastMode ? 'ON ✅' : 'OFF ❌'}`
                }, { quoted: msg });
                return;
            }

            if (cmd === '.loadavg') {
                const load = os.loadavg();
                await sock.sendMessage(from, {
                    text: `📊 *Load Average:*\n\`1m: ${load[0].toFixed(2)}\`\n\`5m: ${load[1].toFixed(2)}\`\n\`15m: ${load[2].toFixed(2)}\``
                }, { quoted: msg });
                return;
            }

        } catch (e) {
            console.error('Fast Mode error:', e.message);
        }
    }
};
