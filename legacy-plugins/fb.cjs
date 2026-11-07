// Facebook Downloader Plugin for HASAA-MD
// Usage: .fb <url>  |  .updatefb  |  Daily auto-test

const getFBInfo = require('@renpwn/fb-downloader');
const { exec } = require('child_process');

// Save sock and config globally for scheduled task
let savedSock = null;
let savedConfig = null;
let lastTestResult = null;

// ==================== HTML ENTITY DECODER ====================
function decodeHtml(str) {
    if (!str || typeof str !== 'string') return str;
    return str
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
            try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
        })
        .replace(/&#(\d+);/g, (_, d) => {
            try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; }
        })
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&apos;/g, "'");
}

// ==================== TEST FUNCTION ====================
async function testFBDownloader() {
    // Public test video (Facebook's own stable video)
    const testUrl = 'https://www.facebook.com/watch/?v=10153231379946729';
    try {
        const result = await getFBInfo(testUrl);
        if (result && (result.hd || result.sd)) {
            return { ok: true, quality: result.hd ? 'HD' : 'SD' };
        }
        return { ok: false, reason: 'No video URL returned' };
    } catch (e) {
        return { ok: false, reason: e.message };
    }
}

// ==================== CHECK FOR UPDATE ====================
function checkUpdate() {
    return new Promise((resolve) => {
        exec('npm view @renpwn/fb-downloader version 2>/dev/null', (err, stdout) => {
            if (err || !stdout) return resolve({ latest: null, current: null, hasUpdate: false });
            const latest = stdout.trim();
            try {
                const pkg = require('@renpwn/fb-downloader/package.json');
                const current = pkg.version;
                resolve({ latest, current, hasUpdate: latest !== current });
            } catch {
                resolve({ latest, current: null, hasUpdate: false });
            }
        });
    });
}

// ==================== SEND TO OWNER ====================
async function notifyOwner(text) {
    if (!savedSock || !savedConfig) return;
    try {
        const sudoNum = (savedConfig.SUDO || '').split(',')[0].trim();
        if (!sudoNum) return;
        const ownerJid = sudoNum.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
        await savedSock.sendMessage(ownerJid, { text });
    } catch (e) {
        console.error('Notify owner error:', e.message);
    }
}

// ==================== DAILY SCHEDULED TASK ====================
// First run: 1 hour after startup. Then every 24 hours.
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

setTimeout(() => {
    runDailyCheck();
    setInterval(runDailyCheck, ONE_DAY);
}, ONE_HOUR);

async function runDailyCheck() {
    if (!savedSock) return;
    try {
        console.log('🔍 Running daily FB downloader check...');
        
        const testResult = await testFBDownloader();
        lastTestResult = testResult;

        const updateInfo = await checkUpdate();

        let msg = '🔔 *Daily FB Downloader Report*\n\n';
        msg += `📅 ${new Date().toLocaleString('en-GB')}\n\n`;

        if (testResult.ok) {
            msg += `✅ *Status:* Working (${testResult.quality})\n`;
        } else {
            msg += `❌ *Status:* BROKEN\n`;
            msg += `⚠️ *Reason:* ${testResult.reason}\n`;
            msg += `\n💡 _Run \`.updatefb\` to try updating the package._\n`;
        }

        if (updateInfo.latest) {
            msg += `\n📦 *Current:* \`${updateInfo.current || 'unknown'}\`\n`;
            msg += `📦 *Latest:* \`${updateInfo.latest}\`\n`;
            if (updateInfo.hasUpdate) {
                msg += `\n⚡ _New version available! Run \`.updatefb\`_\n`;
            } else {
                msg += `\n✅ _Up to date_\n`;
            }
        }

        await notifyOwner(msg);
        console.log('✅ Daily FB check done');
    } catch (e) {
        console.error('Daily check error:', e.message);
    }
}

// ==================== UPDATE FUNCTION ====================
function updatePackage() {
    return new Promise((resolve) => {
        exec('npm install @renpwn/fb-downloader@latest 2>&1', { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) return resolve({ ok: false, output: stderr || err.message });
            resolve({ ok: true, output: stdout });
        });
    });
}

// ==================== EXPORT ====================
module.exports = {
    name: 'fb',

    async onMessage(sock, msg, config) {
        try {
            // Save for scheduled task
            savedSock = sock;
            savedConfig = config;

            const from = msg.key.remoteJid;
            if (!from || from === 'status@broadcast') return;

            const body = (msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text || '').trim();
            const lowerBody = body.toLowerCase();

            // ==================== .updatefb ====================
            if (lowerBody === '.updatefb' || lowerBody === '.fbupdate') {
                await sock.sendMessage(from, { text: '⏳ *Updating FB downloader package...*' }, { quoted: msg });

                const result = await updatePackage();
                
                if (result.ok) {
                    await sock.sendMessage(from, {
                        text: '✅ *Package updated!*\n\n⚠️ *Restart කරන්න ඕන:*\n```pm2 restart hasamd```'
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, {
                        text: `❌ *Update failed:*\n\`\`\`${result.output.slice(0, 300)}\`\`\``
                    }, { quoted: msg });
                }
                return;
            }

            // ==================== .fbtest ====================
            if (lowerBody === '.fbtest') {
                await sock.sendMessage(from, { text: '🔍 *Testing FB downloader...*' }, { quoted: msg });
                const r = await testFBDownloader();
                if (r.ok) {
                    await sock.sendMessage(from, {
                        text: `✅ *FB downloader WORKING* (${r.quality})`
                    }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, {
                        text: `❌ *FB downloader BROKEN*\n\n_Reason:_ ${r.reason}`
                    }, { quoted: msg });
                }
                return;
            }

            // ==================== .fb ====================
            if (!lowerBody.startsWith('.fb')) return;

            const url = body.slice(3).trim();

            if (!url) {
                return await sock.sendMessage(from, {
                    text: "❌ *Facebook video link එක දෙන්න!*\n\nඋදා: `.fb https://fb.watch/xxxxx`"
                }, { quoted: msg });
            }

            await sock.sendMessage(from, { text: "⏳ *Downloading Facebook video...*" }, { quoted: msg });

            try {
                const result = await getFBInfo(url);

                if (!result || (!result.hd && !result.sd)) {
                    throw new Error('No video found');
                }

                const videoUrl = result.hd || result.sd;
                const title = decodeHtml(result.title || 'Facebook Video');
                const quality = result.hd ? 'HD' : 'SD';

                await sock.sendMessage(from, {
                    video: { url: videoUrl },
                    caption: `📥 *${title}*\n📺 *Quality:* ${quality}\n\n> HASAA-MD ⚡`
                }, { quoted: msg });

            } catch (err) {
                console.error('FB download error:', err.message);
                await sock.sendMessage(from, {
                    text: "❌ *Video එක download කරගන්න බැරි වුණා.*\n\n*හේතු:* Link එක වැරදි, private video, හෝ Facebook එකෙන් block කරලා."
                }, { quoted: msg });
            }

        } catch (e) {
            console.error('FB plugin error:', e.message);
        }
    }
};
