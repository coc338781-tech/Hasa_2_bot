const REPO = "coc338781-tech/Hasa_2_bot";
const API = "https://api.github.com";

function isOwner(sender, message, config) {
  if (message.key?.fromMe) return true;
  const number = String(sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(item =>
    String(item).replace(/\D/g, "") === number
  );
}

export default async function testReport({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = message.message?.conversation ||
    message.message?.extendedTextMessage?.text || "";
  if (!/^\.botcheck(?:\s|$)/i.test(body.trim())) return;

  const sender = message.key.participant || jid;
  if (!isOwner(sender, message, config)) {
    return sock.sendMessage(jid, { text: "⛔ මේ පරීක්ෂණය Ownerට පමණයි." }, { quoted: message });
  }

  const plugins = globalThis.__hasaPlugins;
  const checks = {
    commandReceived: true,
    whatsappReply: "reply pending",
    pluginLoader: Boolean(plugins && plugins.count > 0),
    loadedPluginCount: plugins?.count ?? 0,
    loadedPlugins: plugins?.names ?? [],
    nodeVersion: process.version,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  };

  try {
    await sock.sendMessage(jid, {
      text: "🧪 *Hasa_2_bot Test*\n\n✅ WhatsApp command received\n✅ Reply sent successfully\n" +
        (checks.pluginLoader ? "✅ Plugin loader active" : "❌ Plugin loader unavailable") +
        "\n\n🔐 Private test only: message text and chat history are not included in the report."
    }, { quoted: message });
    checks.whatsappReply = "sendMessage accepted";
  } catch (error) {
    checks.whatsappReply = "failed: " + String(error?.message || error).slice(0, 180);
  }

  const token = process.env.BOT_TEST_REPORT_TOKEN;
  if (!token) {
    console.log("[BOTCHECK]", JSON.stringify(checks));
    return;
  }

  const report = [
    "Automated owner-triggered bot check.",
    "",
    "- WhatsApp command received: PASS",
    "- WhatsApp reply: " + checks.whatsappReply,
    "- Plugin loader: " + (checks.pluginLoader ? "PASS" : "FAIL"),
    "- Loaded plugin count: " + checks.loadedPluginCount,
    "- Plugins: " + checks.loadedPlugins.join(", "),
    "- Node: " + checks.nodeVersion,
    "- Uptime seconds: " + checks.uptimeSeconds,
    "- Timestamp: " + checks.timestamp,
    "",
    "Privacy: no chat text, message contents, contacts, media, or chat history are collected or included."
  ].join("\n");

  try {
    const response = await fetch(API + "/repos/" + REPO + "/issues", {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: "[BOTCHECK] " + checks.timestamp,
        body: report,
        labels: ["bot-health-check"]
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error("GitHub API " + response.status + ": " + detail.slice(0, 180));
    }
    const issue = await response.json();
    console.log("[BOTCHECK] Report uploaded:", issue.html_url);
    await sock.sendMessage(jid, {
      text: "📡 Test report එක private GitHub repository එකට යැව්වා.\n" + issue.html_url
    }, { quoted: message });
  } catch (error) {
    console.error("[BOTCHECK] Report upload failed:", error.message);
    await sock.sendMessage(jid, {
      text: "⚠️ WhatsApp test එක වැඩ කළා. නමුත් GitHub report එක යවන්න බැරි වුණා. Server log එකේ දෝෂය සටහන් කළා."
    }, { quoted: message });
  }
}
