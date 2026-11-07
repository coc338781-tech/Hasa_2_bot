// Fake Hack Prank Plugin for HASAA-MD
// OWNER ONLY - Entertainment only. No actual hacking.

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// Simple ASCII banner (WhatsApp friendly)
const BANNER = "```\n╔══════════════════════════════╗\n║   H A S A A - M D  H A C K E R ║\n║      v2.0 | Ghost Protocol     ║\n╚══════════════════════════════╝\n```";

// Hacker theme emojis (monochrome / dark)
const HACKER_EMOJIS = {
    skull: '💀',
    bomb: '💣',
    lock: '🔒',
    unlock: '🔓',
    key: '🔑',
    sat: '📡',
    globe: '🌐',
    computer: '💻',
    server: '🖥️',
    shield: '🛡️',
    warn: '⚠️',
    zap: '⚡',
    target: '🎯',
    alert: '🚨',
    fire: '🔥',
    crossbones: '☠️',
    ghost: '👻',
    diamond: '◆'
};

// Progress bar generator
function progressBar(percent, size = 15) {
    const filled = Math.floor((percent / 100) * size);
    const empty = size - filled;
    return '▓'.repeat(filled) + '░'.repeat(empty) + ` ${percent}%`;
}

// Build the attack sequence
const hackSteps = [
    // Stage 1 - Banner + initial
    { text: BANNER, delay: 1500 },
    { text: `${HACKER_EMOJIS.bomb} *INITIALIZING HACK PROTOCOL...*`, delay: 1200 },
    { text: `${HACKER_EMOJIS.lock} *BYPASSING WHATSAPP ENCRYPTION...*`, delay: 1200 },
    { text: `${HACKER_EMOJIS.key} *INJECTING PAYLOAD INTO TARGET...*`, delay: 1200 },
    { text: `${HACKER_EMOJIS.unlock} *ACCESS GRANTED: /data/com.whatsapp/*`, delay: 1200 }
];

// Progress bar stages (multi-message animation)
const progressStages = [
    { label: `${HACKER_EMOJIS.computer} DOWNLOADING CHAT HISTORY`, from: 0, to: 100 },
    { label: `${HACKER_EMOJIS.server} EXTRACTING CONTACTS`, from: 0, to: 100 },
    { label: `${HACKER_EMOJIS.sat} ACCESSING GALLERY PHOTOS`, from: 0, to: 100 },
    { label: `${HACKER_EMOJIS.shield} READING PRIVATE MESSAGES`, from: 0, to: 100 },
    { label: `${HACKER_EMOJIS.globe} CLONING WHATSAPP SESSION`, from: 0, to: 100 },
    { label: `${HACKER_EMOJIS.bomb} INSTALLING BACKDOOR RAT`, from: 0, to: 100 },
    { label: `${HACKER_EMOJIS.fire} UPLOADING TO DARK WEB SERVER`, from: 0, to: 100 }
];

const finalReport = [
    '',
    `${HACKER_EMOJIS.warn} *ALL DATA COMPROMISED*`,
    '',
    `📱 *Target Device:* ***.***.***`,
    `🌍 *IP Address:* 175.157.***.**`,
    `📸 *Photos Leaked:* 2,847`,
    `💬 *Messages Read:* 18,392`,
    `👥 *Contacts Stolen:* 421`,
    '',
    `${HACKER_EMOJIS.skull} *HASA-MD BY HACKED DONE* ${HACKER_EMOJIS.skull}`
];

module.exports = {
    name: 'hack',

    async onMessage(sock, msg, config) {
        try {
            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const body = (msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '').trim();
            const lowerBody = body.toLowerCase();

            if (!lowerBody.startsWith('.hack')) return;

            // ============ OWNER ONLY ============
            const senderJid = msg.key.participant || from;
            const senderNum = senderJid.split('@')[0].split(':')[0];
            const sudoList = (config.SUDO || '').split(',').map(s => s.trim()).filter(Boolean);
            const isOwner = sudoList.includes(senderNum) || msg.key.fromMe;

            if (!isOwner) {
                return await sock.sendMessage(from, {
                    text: `⛔ *මේ command එක owner ට විතරයි!*`
                }, { quoted: msg });
            }

            const mention = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const targetJid = mention || from;

            // Start
            await sock.sendMessage(from, {
                text: `${HACKER_EMOJIS.skull} *HASAA-MD HACKER MODE ACTIVATED* ${HACKER_EMOJIS.skull}`
            }, { quoted: msg });

            await delay(1500);

            // Initial steps
            for (const step of hackSteps) {
                await sock.sendMessage(targetJid, { text: step.text });
                await delay(step.delay);
            }

            // Progress bar animation
            for (const stage of progressStages) {
                // Send starting message
                await sock.sendMessage(targetJid, {
                    text: `${stage.label}...\n\`${progressBar(0)}\``
                });

                // Animate percentages
                const percents = [5, 15, 28, 42, 55, 68, 78, 85, 92, 97, 100];
                for (const p of percents) {
                    await delay(400);
                    await sock.sendMessage(targetJid, {
                        text: `\`${progressBar(p)}\``
                    });
                }

                await delay(500);
            }

            // Final report
            for (const line of finalReport) {
                await sock.sendMessage(targetJid, { text: line });
                await delay(600);
            }

        } catch (e) {
            console.error('Hack prank error:', e.message);
        }
    }
};
