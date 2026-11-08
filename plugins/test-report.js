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
  const reportRepo = String(process.env.BOT_TEST_REPORT_REPO || "").trim();
  if (!token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(reportRepo)) {
    console.log("[BOTCHECK] Local-only report; private report repository is not configured.", JSON.stringify(checks));
    return;
  }

  try {
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    const privacyCheck = await fetch(API + "/repos/" + reportRepo, {
      headers,
      signal: AbortSignal.timeout(10000)
    });
    if (!privacyCheck.ok) {
      const status = privacyCheck.status;
      throw new Error("Repository access check failed (HTTP " + status + "). Check token access to the private report repo.");
    }
    const repository = await privacyCheck.json();
    if (!repository.private) {
      console.error("[BOTCHECK] Refusing to upload: report repository is not private.");
      await sock.sendMessage(jid, {
        text: "🔒 Report එක upload කළේ නැහැ. Report repo එක private නොවන නිසා ආරක්ෂාවට නතර කළා."
      }, { quoted: message });
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

    const response = await fetch(API + "/repos/" + reportRepo + "/issues", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "[BOTCHECK] " + checks.timestamp,
        body: report
      }),
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
      throw new Error("GitHub issue creation failed (HTTP " + response.status + "). Check that the token has Issues read/write access to the private report repo.");
    }
    const issue = await response.json();
    console.log("[BOTCHECK] Report uploaded:", issue.html_url);
    await sock.sendMessage(jid, {
      text: "📡 Test report එක private GitHub repository එකට යැව්වා.\n" + issue.html_url
    }, { quoted: message });
  } catch (error) {
    const detail = String(error?.message || error).slice(0, 220);
    console.error("[BOTCHECK] Report upload failed:", detail);
    let advice = "Server network එක හෝ GitHub token/repo access එක පරීක්ෂා කළ යුතුයි.";
    if (/HTTP 401/.test(detail)) advice = "GitHub token එක invalid හෝ expired. Token එක අලුත් කර secret එක update කරන්න.";
    else if (/HTTP 403/.test(detail)) advice = "Token එකට private repo එකේ Issues read/write permission නැහැ, නැත්නම් rate limit එකක්.";
    else if (/HTTP 404/.test(detail)) advice = "Repo නම වැරදි හෝ token එකට private repo එක පෙනෙන්නේ නැහැ.";
    else if (/timed out|fetch failed|ENOTFOUND|ECONN/.test(detail)) advice = "Oracle server එකෙන් GitHub වෙත network connection එක අසාර්ථකයි.";
    await sock.sendMessage(jid, {
      text: "⚠️ GitHub report upload අසාර්ථකයි.\n හේතුව: " + detail + "\n" + advice + "\n\n🔐 Chat messages කිසිවක් report එකට ඇතුළත් කරන්නේ නැහැ."
    }, { quoted: message });
  }
}
