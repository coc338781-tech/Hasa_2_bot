// Anti-Delete Plugin for HASAA-MD
// Settings: 15.1 - 15.6
// 15.1 = All (Inbox + Groups), 15.2 = Off
// 15.3 = Inbox Only, 15.4 = Groups Only, 15.5 = All, 15.6 = Send to My Inbox

const messageCache = new Map();
const MAX_CACHE = 500;

module.exports = {
    name: 'anti-delete',

    async onMessage(sock, msg, config) {
        try {
            const mode = config.antiDelete || 'off';
            const toInbox = config.antiDeleteToInbox || false;

            if (mode === 'off') return;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const protocolMsg = msg.message?.protocolMessage;

            // If not a protocol message - cache it for later
            if (!protocolMsg) {
                if (msg.key.id && msg.message && !msg.key.fromMe) {
                    messageCache.set(msg.key.id, {
                        msg,
                        from,
                        sender: msg.key.participant || from,
                        timestamp: Date.now()
                    });
                    if (messageCache.size > MAX_CACHE) {
                        const firstKey = messageCache.keys().next().value;
                        messageCache.delete(firstKey);
                    }
                }
                return;
            }

            // Protocol message - check for REVOKE (delete)
            if (protocolMsg.type !== 0) return;

            const revokedId = protocolMsg.key?.id;
            if (!revokedId) return;

            const cached = messageCache.get(revokedId);
            if (!cached) return;

            const isGroup = from.endsWith('@g.us');
            if (mode === 'inbox' && isGroup) return;
            if (mode === 'groups' && !isGroup) return;

            const senderNum = cached.sender.split('@')[0];
            const timeStr = new Date(cached.timestamp).toLocaleString('en-GB');

            let alertText = `🚨 *ANTI-DELETE ALERT* 🚨\n\n`;
            alertText += `📱 *Sender:* +${senderNum}\n`;
            alertText += `💬 *Chat:* ${isGroup ? 'Group' : 'Inbox'}\n`;
            alertText += `🕐 *Time:* ${timeStr}\n\n`;
            alertText += `📄 *Deleted Message:*\n`;

            const originalMsg = cached.msg;
            const body = originalMsg.message?.conversation ||
                         originalMsg.message?.extendedTextMessage?.text ||
                         originalMsg.message?.imageMessage?.caption ||
                         originalMsg.message?.videoMessage?.caption || '';

            if (body) {
                alertText += `> ${body}`;
            } else {
                alertText += `> _(media message)_`;
            }

            // Decide where to send
            const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
            const targetJid = toInbox ? botJid : from;

            await sock.sendMessage(targetJid, { text: alertText });

            // If original had media - forward it
            const hasMedia = originalMsg.message?.imageMessage ||
                            originalMsg.message?.videoMessage ||
                            originalMsg.message?.audioMessage ||
                            originalMsg.message?.documentMessage ||
                            originalMsg.message?.stickerMessage;

            if (hasMedia) {
                try {
                    await sock.sendMessage(targetJid, {
                        forward: cached.msg,
                        force: true
                    });
                } catch (e) {
                    console.error('Anti-Delete forward error:', e.message);
                }
            }

            messageCache.delete(revokedId);

        } catch (e) {
            console.error('Anti-Delete error:', e.message);
        }
    }
};
