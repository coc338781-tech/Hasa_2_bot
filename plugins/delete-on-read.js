const READ_STATUS = 4;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function getBody(message) {
  return message?.message?.conversation ||
    message?.message?.extendedTextMessage?.text ||
    message?.message?.imageMessage?.caption ||
    message?.message?.videoMessage?.caption || "";
}

function pendingKey(key) {
  return key?.remoteJid && key?.id ? key.remoteJid + ":" + key.id : null;
}

export function createDeleteOnReadPlugin() {
  const pending = new Map();

  async function run({ sock, message, config = {} }) {
    const key = message?.key;
    const jid = key?.remoteJid;
    if (!jid || jid === "status@broadcast" || jid.endsWith("@g.us")) return;
    if (key.fromMe !== true) return;

    const prefix = config.prefix || ".";
    const body = getBody(message).trim();
    if (!body.startsWith(prefix)) return;

    const commandBody = body.slice(prefix.length).trim();
    const match = commandBody.match(/^d(?:\s+([\s\S]+))?$/i);
    if (!match) return;

    const text = String(match[1] || "").trim();
    if (!text) {
      try { await sock.sendMessage(jid, { delete: key }); } catch (error) {
        console.error("Delete-on-read command cleanup failed:", error.message);
      }
      return sock.sendMessage(jid, {
        text: "භාවිතය: " + prefix + "D <පණිවිඩය>\nඋදා: " + prefix + "D හායි"
      });
    }

    // Remove the command itself so the recipient is left with the clean message only.
    try {
      await sock.sendMessage(jid, { delete: key });
    } catch (error) {
      console.error("Delete-on-read command cleanup failed:", error.message);
    }

    let sent;
    try {
      sent = await sock.sendMessage(jid, { text });
    } catch (error) {
      console.error("Delete-on-read send failed:", error.message);
      return;
    }

    const sentKey = sent?.key;
    const id = pendingKey(sentKey);
    if (!id || sentKey.fromMe !== true) {
      console.error("Delete-on-read: sent message key was not returned; read tracking skipped.");
      return;
    }

    const timer = setTimeout(() => pending.delete(id), PENDING_TTL_MS);
    timer.unref?.();
    pending.set(id, { jid, key: sentKey, timer });
  }

  function onConnection(sock) {
    sock.ev.on("messages.update", async updates => {
      for (const item of updates || []) {
        const key = item?.key;
        const status = Number(item?.update?.status);
        if (!key?.fromMe || !Number.isFinite(status) || status < READ_STATUS) continue;

        const id = pendingKey(key);
        const target = id && pending.get(id);
        if (!target) continue;

        clearTimeout(target.timer);
        pending.delete(id);
        try {
          await sock.sendMessage(target.jid, { delete: target.key });
          console.log("Delete-on-read: message deleted after read receipt.");
        } catch (error) {
          console.error("Delete-on-read deletion failed:", error.message);
        }
      }
    });
  }

  return { run, onConnection, pending };
}

const plugin = createDeleteOnReadPlugin();
export const onConnection = plugin.onConnection;
export const commands = [{
  name: "D",
  category: "5",
  usage: "D <message>",
  description: "කියවූ විට පණිවිඩය Delete for Everyone කරයි (Private Chat)"
}];

export default plugin.run;
