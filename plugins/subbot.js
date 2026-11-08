import { startSubbot, stopSubbot, listSubbots, findSavedSubbotOwners } from "../lib/subbot-manager.js";
import { restartAllSubbots, deleteAllSubbots } from "../lib/subbot-bulk.js";

function ownerAllowed(sender, message, config) {
  if (message.key.fromMe) return true;
  const number = String(sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(item => String(item).replace(/\D/g, "") === number);
}

export default async function subbot({ sock, message, config }) {
  const chat = message.key?.remoteJid;
  if (!chat) return;
  const body = (message.message?.conversation || message.message?.extendedTextMessage?.text || "").trim();
  const prefix = config.prefix || ".";
  if (!body.startsWith(prefix)) return;
  const [rawCommand, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const valid = ["subbot", "subcheck", "getsubbot", "stopsubbot", "delsubbot", "restartsubbot", "delallsubbot", "restartallsubbot", "helpsubbot"];
  if (!valid.includes(command)) return;
  const sender = message.key.participant || chat;
  if (!ownerAllowed(sender, message, config)) {
    return sock.sendMessage(chat, { text: "⛔ Subbot commands are owner only." }, { quoted: message });
  }
  const ownerJid = sender.includes("@") ? sender : chat;
  const ownerNumber = ownerJid.split("@")[0].split(":")[0];
  if (command === "helpsubbot") {
    return sock.sendMessage(chat, { text:
      "*SUBBOT COMMANDS*\n" +
      prefix + "subbot <phone number> - Start a new subbot using pairing code\n" +
      prefix + "subcheck - Check status\n" +
      prefix + "getsubbot - List active subbots\n" +
      prefix + "stopsubbot - Stop but keep session\n" +
      prefix + "restartsubbot - Restart saved session\n" +
      prefix + "delsubbot - Stop and delete this subbot session\n" +
      prefix + "delallsubbot confirm - Stop and delete all saved subbot sessions\n" +
      prefix + "restartallsubbot - Restart all saved subbots"
    }, { quoted: message });
  }
  if (command === "subbot") {
    try {
      const phone = args.join("").replace(/\D/g, "");
      if (!phone) return sock.sendMessage(chat, { text: "Phone number with country code දෙන්න. උදා: .subbot 9477XXXXXXX" }, { quoted: message });
      await startSubbot({ ownerJid: ownerNumber + "@s.whatsapp.net", phoneNumber: phone, mainSock: sock, config, plugins: globalThis.__hasaPlugins });
      return sock.sendMessage(chat, { text: "⏳ Subbot connecting. Pairing code එක private chat එකට එවන්නම්." }, { quoted: message });
    } catch (error) {
      return sock.sendMessage(chat, { text: "❌ " + error.message }, { quoted: message });
    }
  }
  if (command === "subcheck") {
    const item = listSubbots().find(x => x.owner === ownerNumber);
    return sock.sendMessage(chat, { text: item ? "🟢 Subbot active\nConnected: " + item.connected + "\nJID: " + (item.jid || "Connecting") : "No active subbot. Use .subbot <phone>." }, { quoted: message });
  }
  if (command === "getsubbot") {
    const all = listSubbots();
    return sock.sendMessage(chat, { text: all.length ? all.map((x, i) => (i+1)+". "+x.owner+" - "+(x.connected ? "Online" : "Connecting")).join("\n") : "No active subbots." }, { quoted: message });
  }
  if (command === "stopsubbot") {
    await stopSubbot(ownerNumber);
    return sock.sendMessage(chat, { text: "⏹️ Subbot stopped. Saved session was kept." }, { quoted: message });
  }
  if (command === "delsubbot") {
    await stopSubbot(ownerNumber, { removeSession: true });
    return sock.sendMessage(chat, { text: "🗑️ Subbot stopped and its separate session folder deleted." }, { quoted: message });
  }

  if (command === "delallsubbot") {
    if ((args[0] || "").toLowerCase() !== "confirm") {
      const count = new Set([...findSavedSubbotOwners(), ...listSubbots().map(item => item.owner)]).size;
      return sock.sendMessage(chat, { text: "⚠️ මෙය සියලුම Subbot sessions මකා දමයි (" + count + " saved). තහවුරු කිරීමට: " + prefix + "delallsubbot confirm" }, { quoted: message });
    }
    const owners = [...new Set([...findSavedSubbotOwners(), ...listSubbots().map(item => item.owner)])];
    const results = await deleteAllSubbots(owners, owner => stopSubbot(owner, { removeSession: true }));
    const failed = results.filter(item => !item.ok);
    return sock.sendMessage(chat, { text: "🗑️ *BULK SUBBOT DELETE*\nDeleted: " + (results.length - failed.length) + " / " + results.length + (failed.length ? "\nFailed: " + failed.map(item => item.owner + " (" + item.error + ")").join(", ") : "") }, { quoted: message });
  }
  if (command === "restartallsubbot") {
    const owners = [...new Set([...findSavedSubbotOwners(), ...listSubbots().map(item => item.owner)])];
    if (!owners.length) return sock.sendMessage(chat, { text: "Restart කරන්න saved Subbot session එකක් නැහැ." }, { quoted: message });
    const results = await restartAllSubbots(owners, {
      stop: owner => stopSubbot(owner),
      start: owner => startSubbot({ ownerJid: owner + "@s.whatsapp.net", mainSock: sock, config, plugins: globalThis.__hasaPlugins })
    });
    const failed = results.filter(item => !item.ok);
    return sock.sendMessage(chat, { text: "🔄 *BULK SUBBOT RESTART*\nRestart requested: " + (results.length - failed.length) + " / " + results.length + (failed.length ? "\nFailed: " + failed.map(item => item.owner + " (" + item.error + ")").join(", ") : "") }, { quoted: message });
  }

  if (command === "restartsubbot") {
    try {
      await stopSubbot(ownerNumber);
      await startSubbot({ ownerJid: ownerNumber + "@s.whatsapp.net", mainSock: sock, config, plugins: globalThis.__hasaPlugins });
      return sock.sendMessage(chat, { text: "🔄 Subbot restart requested. Saved session is being reused." }, { quoted: message });
    } catch (error) {
      return sock.sendMessage(chat, { text: "❌ " + error.message }, { quoted: message });
    }
  }
}
