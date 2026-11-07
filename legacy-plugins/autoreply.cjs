// Auto Reply Plugin for HASAA-MD
// Handles: auto-reply matching, .replaceeply, .resetreply
// Note: .addreply, .removereply, .getreply are handled by index.js

const fs = require('fs');
const path = require('path');

const REPLIES_FILE = path.join(process.cwd(), 'replies.json');

// ==================== STORAGE ====================
function getReplies() {
    try {
        if (!fs.existsSync(REPLIES_FILE)) {
            fs.writeFileSync(REPLIES_FILE, '{}');
            return {};
        }
        return JSON.parse(fs.readFileSync(REPLIES_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveReplies(data) {
    try {
        fs.writeFileSync(REPLIES_FILE, JSON.stringify(data, null, 2));
        return true;
    } catch {
        return false;
    }
}

// ==================== LOOP PROTECTION ====================
const recentReplies = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [k, t] of recentReplies) {
        if (now - t > 60000) recentReplies.delete(k);
    }
}, 60000);

// ==================== EXPORT ====================
module.exports = {
    name: 'autoreply',

    async onMessage(sock, msg, config) {
        try {
            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const body = (msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         msg.message?.imageMessage?.caption ||
                         msg.message?.videoMessage?.caption || '').trim();

            if (!body) return;

            const lowerBody = body.toLowerCase();

            // ==================== .replaceeply ====================
            if (lowerBody.startsWith('.replaceeply')) {
                const args = body.split(/ +/).slice(1).join(' ');
                const parts = args.split('-');
                if (parts.length < 2) {
                    return await sock.sendMessage(from, {
                        text: "❌ *භාවිතය:* `.replaceeply වචනය-අලුත් උත්තරය`\n\n*උදා:* `.replaceeply hi-Hello Machan!`"
                    }, { quoted: msg });
                }
                const trigger = parts[0].trim().toLowerCase();
                const response = parts.slice(1).join('-').trim();
                const replies = getReplies();

                if (!replies[trigger]) {
                    return await sock.sendMessage(from, {
                        text: `❌ *\`${trigger}\` වලට auto reply එකක් නෑ!*\n\nමුලින්ම \`.addreply\` කරන්න.`
                    }, { quoted: msg });
                }

                replies[trigger] = response;
                saveReplies(replies);
                return await sock.sendMessage(from, {
                    text: `🔄 *Auto Reply Replaced!*\n\n🎯 *Word:* \`${trigger}\`\n💬 *New Reply:* \`${response}\``
                }, { quoted: msg });
            }

            // ==================== .resetreply ====================
            if (lowerBody === '.resetreply') {
                saveReplies({});
                return await sock.sendMessage(from, {
                    text: "🗑️ *හැම Auto Reply එකක්ම Delete කළා!*"
                }, { quoted: msg });
            }

            // Skip commands
            if (body.startsWith('.')) return;

            // ==================== AUTO REPLY MATCHING ====================
            const replies = getReplies();
            if (!replies[lowerBody]) return;

            // Loop protection
            const key = `${from}-${lowerBody}`;
            if (msg.key.fromMe && recentReplies.has(key)) return;
            recentReplies.set(key, Date.now());

            await sock.sendMessage(from, {
                text: replies[lowerBody]
            }, { quoted: msg });

        } catch (e) {
            console.error('AutoReply error:', e.message);
        }
    }
};
