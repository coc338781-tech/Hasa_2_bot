// Composing Plugin for HASAA-MD
// Settings: 13.1 (ON), 13.2 (OFF)
// Shows "typing..." before bot replies

module.exports = {
    name: 'composing',

    async onMessage(sock, msg, config) {
        try {
            if (!config.composing) return;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;
            if (msg.key.fromMe) return;

            // Send composing presence (typing indicator)
            await sock.sendPresenceUpdate('composing', from);

            // Wait 2 seconds to show typing
            await new Promise(r => setTimeout(r, 2000));

            // Pause typing
            await sock.sendPresenceUpdate('paused', from);

        } catch (e) {
            console.error('Composing error:', e.message);
        }
    }
};
