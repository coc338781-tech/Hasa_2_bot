const fs = require('fs');
const path = require('path');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const pino = require('pino');

// Global subbot storage
global.subbots = global.subbots || {};

// Plugin loader
function loadPlugins() {
    const commandsMap = new Map();
    const pluginsPath = path.join(process.cwd(), 'plugins');

    if (!fs.existsSync(pluginsPath)) return commandsMap;

    const files = fs.readdirSync(pluginsPath).filter(f =>
        (f.endsWith('.js') || f.endsWith('.cjs')) && f.toLowerCase() !== 'subbot.cjs'
    );

    for (const file of files) {
        try {
            const plugin = require(path.join(pluginsPath, file));
            const cmd = plugin.default || plugin;
            if (cmd?.name && cmd?.execute) {
                commandsMap.set(cmd.name, cmd);
            }
        } catch (e) {
            console.error(`Subbot plugin load error (${file}):`, e.message);
        }
    }
    return commandsMap;
}

// Start a subbot with session ID
async function startSubbot(sessionId, ownerJid, mainSock, mek) {
    try {
        const cleanSession = sessionId.replace(/^HASAA~/, '').trim();
        let credsData;
        try {
            credsData = Buffer.from(cleanSession, 'base64').toString('utf8');
            JSON.parse(credsData);
        } catch {
            throw new Error('Invalid Session ID format');
        }

        const sessionDir = `./subbot_sessions/${ownerJid.replace(/[^0-9]/g, '')}`;
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        fs.writeFileSync(path.join(sessionDir, 'creds.json'), credsData);

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const subSock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: state,
            browser: ['HASAA-MD', 'Chrome', '1.0.0']
        });

        subSock.ev.on('creds.update', saveCreds);

        const subCommands = loadPlugins();

        subSock.ev.on('messages.upsert', async (m) => {
            try {
                const msg = m.messages[0];
                if (!msg || !msg.message) return;
                const from = msg.key.remoteJid;
                if (from === 'status@broadcast') return;

                const body = msg.message.conversation ||
                             msg.message.extendedTextMessage?.text ||
                             msg.message.imageMessage?.caption ||
                             msg.message.videoMessage?.caption || '';

                if (!body.startsWith('.')) return;

                const args = body.trim().split(/ +/);
                const command = args.shift().toLowerCase();
                const cmdName = command.slice(1);

                if (subCommands.has(cmdName)) {
                    const plugin = subCommands.get(cmdName);
                    try {
                        await plugin.execute(subSock, msg, args, cmdName);
                        return;
                    } catch (e) {
                        console.error('Subbot cmd error:', e);
                    }
                }

                if (command === '.ping') {
                    return await subSock.sendMessage(from, {
                        text: `⚡ *Pong!* (Subbot)\nJID: \`${subSock.user.id.split(':')[0]}\``
                    }, { quoted: msg });
                }

                if (command === '.alive') {
                    return await subSock.sendMessage(from, {
                        text: `*Subbot Online!* ⚡\n\n📱 JID: \`${subSock.user.id.split(':')[0]}\``
                    }, { quoted: msg });
                }
            } catch (e) {
                console.error('Subbot message handler error:', e);
            }
        });

        subSock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const code = lastDisconnect?.error?.output?.statusCode;
                delete global.subbots[ownerJid];
                if (code !== DisconnectReason.loggedOut) {
                    setTimeout(() => {
                        startSubbot(sessionId, ownerJid, mainSock, mek);
                    }, 5000);
                }
            } else if (connection === 'open') {
                try {
                    await mainSock.sendMessage(ownerJid, {
                        text: `✅ *Subbot Connected!*\n\n📱 \`${subSock.user.id.split(':')[0]}\`\n📦 Plugins: \`${subCommands.size}\``
                    }, { quoted: mek });
                } catch {}
            }
        });

        global.subbots[ownerJid] = {
            sock: subSock,
            sessionDir,
            sessionId,
            startedAt: Date.now()
        };

        return { success: true, plugins: subCommands.size };
    } catch (err) {
        console.error('Subbot start error:', err);
        return { success: false, error: err.message };
    }
}

// Export
module.exports = {
    name: 'subbot',
    async execute(hasamd, mek, args, commandName) {
        try {
            const chat = mek.key.remoteJid;
            const sender = mek.key.participant || mek.key.remoteJid;
            const cmd = (commandName || '').toLowerCase();
            const text = (args || []).join(" ").trim();

            switch (cmd) {
                case 'subbot': {
                    if (!text) {
                        return await hasamd.sendMessage(chat, {
                            text: "⚠️ *Session ID එක දෙන්න!*\n\nඋදා: `.subbot HASAA~xxxxx`"
                        }, { quoted: mek });
                    }
                    if (!text.startsWith('HASAA~')) {
                        return await hasamd.sendMessage(chat, {
                            text: "❌ *වැරදි Session ID!*\n\n`HASAA~` වලින් පටන් ගන්න ඕන."
                        }, { quoted: mek });
                    }
                    if (global.subbots[sender]) {
                        return await hasamd.sendMessage(chat, {
                            text: "⚠️ *ඔබට දැනටමත් active Subbot එකක් තියෙනවා!*\n\nමුලින්ම `.delsubbot` කරන්න."
                        }, { quoted: mek });
                    }
                    await hasamd.sendMessage(chat, {
                        text: "⏳ *Subbot connect වෙමින්...*"
                    }, { quoted: mek });

                    const result = await startSubbot(text, sender, hasamd, mek);
                    if (!result.success) {
                        await hasamd.sendMessage(chat, {
                            text: `❌ *Failed:* ${result.error}`
                        }, { quoted: mek });
                    }
                    break;
                }

                case 'subcheck': {
                    const sub = global.subbots[sender];
                    if (sub) {
                        const up = Math.floor((Date.now() - sub.startedAt) / 1000);
                        await hasamd.sendMessage(chat, {
                            text: `🔍 *Subbot Active* 🟢\n\n⏱️ Uptime: ${up}s\n📱 JID: \`${sub.sock.user?.id || 'N/A'}\``
                        }, { quoted: mek });
                    } else {
                        await hasamd.sendMessage(chat, { text: "❌ Active Subbot එකක් නෑ." }, { quoted: mek });
                    }
                    break;
                }

                case 'getsubbot': {
                    const keys = Object.keys(global.subbots);
                    let listText = `📋 *Active Subbots (${keys.length}):*\n\n`;
                    keys.forEach((k, i) => { listText += `${i + 1}. ${k.split('@')[0]}\n`; });
                    if (keys.length === 0) listText += "None.";
                    await hasamd.sendMessage(chat, { text: listText }, { quoted: mek });
                    break;
                }

                case 'delsubbot': {
                    if (global.subbots[sender]) {
                        const dir = global.subbots[sender].sessionDir;
                        try { global.subbots[sender].sock.ws.close(); } catch {}
                        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
                        delete global.subbots[sender];
                        await hasamd.sendMessage(chat, { text: "🗑️ Subbot deleted!" }, { quoted: mek });
                    } else {
                        await hasamd.sendMessage(chat, { text: "❌ Delete කරන්න Subbot එකක් නෑ." }, { quoted: mek });
                    }
                    break;
                }

                case 'delallsubbot': {
                    for (const k in global.subbots) {
                        try { global.subbots[k].sock.ws.close(); } catch {}
                        try { fs.rmSync(global.subbots[k].sessionDir, { recursive: true, force: true }); } catch {}
                    }
                    global.subbots = {};
                    await hasamd.sendMessage(chat, { text: "⚠️ All subbots deleted!" }, { quoted: mek });
                    break;
                }

                case 'restartsubbot': {
                    if (!global.subbots[sender]) {
                        return await hasamd.sendMessage(chat, { text: "❌ Active Subbot එකක් නෑ." }, { quoted: mek });
                    }
                    const sid = global.subbots[sender].sessionId;
                    try { global.subbots[sender].sock.ws.close(); } catch {}
                    delete global.subbots[sender];
                    await hasamd.sendMessage(chat, { text: "🔄 Restarting..." }, { quoted: mek });
                    await startSubbot(sid, sender, hasamd, mek);
                    break;
                }

                case 'restartallsubbot': {
                    const all = { ...global.subbots };
                    const total = Object.keys(all).length;
                    await hasamd.sendMessage(chat, { text: `🔄 Restarting ${total} subbot(s)...` }, { quoted: mek });
                    for (const k in all) {
                        const sid = all[k].sessionId;
                        try { all[k].sock.ws.close(); } catch {}
                        delete global.subbots[k];
                        await startSubbot(sid, k, hasamd, mek);
                    }
                    break;
                }

                case 'helpsubbot': {
                    await hasamd.sendMessage(chat, {
                        text: "❓ *SUBBOT HELP*\n\n" +
                              "🔹 `.subbot <SESSION_ID>` - Connect\n" +
                              "🔹 `.subcheck` - Status\n" +
                              "🔹 `.getsubbot` - List\n" +
                              "🔹 `.delsubbot` - Delete\n" +
                              "🔹 `.delallsubbot` - Delete all\n" +
                              "🔹 `.restartsubbot` - Restart\n" +
                              "🔹 `.restartallsubbot` - Restart all"
                    }, { quoted: mek });
                    break;
                }
            }
        } catch (err) {
            console.error('Subbot plugin error:', err);
        }
    }
};
