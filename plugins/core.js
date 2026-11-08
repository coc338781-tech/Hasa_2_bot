import fs from "node:fs";
import os from "node:os";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const SETTINGS = [
  { id: "1.1", key: "autoReply", label: "Auto Reply", value: true },
  { id: "1.2", key: "autoReply", label: "Auto Reply", value: false },
  { id: "2.1", key: "autoStatusSeen", label: "Auto Status Seen", value: true },
  { id: "2.2", key: "autoStatusSeen", label: "Auto Status Seen", value: false },
  { id: "3.1", key: "antiDelete", label: "Anti Delete", value: true },
  { id: "3.2", key: "antiDelete", label: "Anti Delete", value: false },
  { id: "4.1", key: "viewOnce", label: "View Once", value: true },
  { id: "4.2", key: "viewOnce", label: "View Once", value: false },
  { id: "5.1", key: "aiChat", label: "AI Chat", value: true },
  { id: "5.2", key: "aiChat", label: "AI Chat", value: false },
  { id: "6.1", key: "groupCommands", label: "Group Commands", value: true },
  { id: "6.2", key: "groupCommands", label: "Group Commands", value: false },
  { id: "7.1", key: "composing", label: "Typing Presence", value: true },
  { id: "7.2", key: "composing", label: "Typing Presence", value: false },
  { id: "8.1", key: "autoVoice", label: "Auto Voice", value: true },
  { id: "8.2", key: "autoVoice", label: "Auto Voice", value: false },
  { id: "9.1", key: "statusReact", label: "Status React: Green Heart 💚", value: "green" },
  { id: "9.2", key: "statusReact", label: "Status React: Random Emoji 🎲", value: "random" },
  { id: "9.3", key: "statusReact", label: "Status React", value: "off" }
];

const CATEGORIES = {
  "1": ["BASIC & MAIN", [
    ".menu", ".list", ".ping", ".alive", ".uptime", ".system", ".ram", ".fastmode", ".loadavg"
  ]],
  "2": ["GROUP", [
    ".tagall [message]", ".hidetag [message]", ".promote @user",
    ".demote @user", ".kick @user", ".groupinfo"
  ]],
  "3": ["DOWNLOAD", [".dl <url>", ".fb <url>"]],
  "4": ["AI & PRANK", [".ai <question>", ".hack"]],
  "5": ["AUTO REPLY", [
    ".addreply word-reply", ".replacereply word-reply", ".getreply",
    ".removereply word", ".resetreply"
  ]],
  "6": ["OWNER & SETTINGS", [
    ".settings", ".apply", "set 1.1 Bot Name", "set 1.3 Footer",
    "set 1.4 Alive Message", ".autoreply on/off", ".statusseen on/off",
    ".statusreact green|random|off", ".antidelete on/off", ".viewonce on/off", ".aichat on/off",
    ".groupcmd on/off", ".composing on/off", ".autovoice on/off"
  ]],
  "7": ["SUBBOT", [
    ".subbot <number>", ".subcheck", ".getsubbot", ".stopsubbot",
    ".restartsubbot", ".delsubbot", ".helpsubbot"
  ]]
};

function isEnabled(value) {
  if (typeof value === "string") return !["off", "false", "0"].includes(value.toLowerCase());
  return Boolean(value);
}

function saveConfig(config) {
  fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
}

function isOwner(sender, message, config) {
  if (message.key?.fromMe) return true;
  const number = String(sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(item =>
    String(item).replace(/\D/g, "") === number
  );
}

function getBody(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function getQuotedBody(message) {
  const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return "";
  return quoted.conversation ||
    quoted.extendedTextMessage?.text ||
    quoted.imageMessage?.caption ||
    quoted.videoMessage?.caption || "";
}

function getQuotedImage(message) {
  const quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return quoted?.imageMessage || message.message?.imageMessage || null;
}

async function downloadLogo(imageMessage) {
  const stream = await downloadContentFromMessage(imageMessage, "image");
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error("Photo එකෙන් image data ලැබුණේ නැහැ.");
  fs.writeFileSync("./bot_logo.jpg", buffer);
}

async function sendWithLogo(sock, jid, message, caption, config) {
  const logoPath = config.BOT_LOGO || "./bot_logo.jpg";
  if (fs.existsSync(logoPath)) {
    try {
      return await sock.sendMessage(jid, {
        image: fs.readFileSync(logoPath),
        caption
      }, { quoted: message });
    } catch (error) {
      console.error("Panel logo send failed:", error.message);
    }
  }
  return sock.sendMessage(jid, { text: caption }, { quoted: message });
}

function makeMainMenu(config) {
  const total = (os.totalmem() / 1024 / 1024).toFixed(0);
  const free = (os.freemem() / 1024 / 1024).toFixed(0);
  const used = total - free;
  const names = [
    "1   BASIC & MAIN",
    "2   GROUP",
    "3   DOWNLOAD",
    "4   AI & PRANK",
    "5   AUTO REPLY",
    "6   OWNER & SETTINGS",
    "7   SUBBOT"
  ];
  return [
    "*HELLO! WELCOME TO HASA 2 BOT*",
    "╭───「 *COMMANDS PANEL* 」",
    "│ ◈ RAM USAGE - *" + used + "MB / " + total + "MB*",
    "│ ◈ RUNTIME - *" + Math.floor(process.uptime() / 60) + " MINUTES*",
    "╰────────────────────",
    "",
    "⛵ *LIST MENU*",
    ...names.map(line => "│ " + line),
    "╰────────────────────",
    "",
    "*Reply to this message with the number you want to select.*",
    "",
    "📜 Full command list: .list",
    "⚙️ Settings: .settings"
  ].join("\n");
}

function makeCommandList(config, prefix) {
  const groups = [
    ["BASIC & MAIN COMMANDS", [prefix+"menu", prefix+"list", prefix+"ping", prefix+"alive", prefix+"uptime", prefix+"system", prefix+"ram", prefix+"fastmode", prefix+"loadavg"]],
    ["GROUP COMMANDS", [prefix+"tagall", prefix+"hidetag", prefix+"promote", prefix+"demote", prefix+"kick", prefix+"groupinfo"]],
    ["DOWNLOAD COMMANDS", [prefix+"dl <url>", prefix+"fb <url>"]],
    ["AI & PRANK COMMANDS", [prefix+"ai <question>", prefix+"hack"]],
    ["AUTO REPLY COMMANDS", [prefix+"addreply word-reply", prefix+"replacereply word-reply", prefix+"getreply", prefix+"removereply word", prefix+"resetreply"]],
    ["OWNER & BOT CONTROL", [prefix+"settings", prefix+"apply", "set 1.1 Bot Name", "set 1.3 Footer", "set 1.4 Alive Message", prefix+"autoreply on/off", prefix+"statusseen on/off", prefix+"statusreact green|random|off", prefix+"antidelete on/off", prefix+"viewonce on/off", prefix+"aichat on/off", prefix+"groupcmd on/off", prefix+"composing on/off", prefix+"autovoice on/off"]],
    ["SUBBOT COMMANDS", [prefix+"subbot <number>", prefix+"subcheck", prefix+"getsubbot", prefix+"stopsubbot", prefix+"restartsubbot", prefix+"delsubbot", prefix+"helpsubbot"]]
  ];
  return [
    "*HELLO! HASA 2 BOT COMMAND LIST*",
    "╭───「 *COMMANDS PANEL* 」",
    "│ ◈ RUNTIME - *" + Math.floor(process.uptime() / 60) + " MINUTES*",
    "╰────────────────────",
    ...groups.flatMap(([title, commands]) => [
      "",
      "╭──────────●●►",
      "*│📜 " + title + "*",
      "│   ───────",
      ...commands.map(command => "*│►* " + command),
      "╰───────────●●►"
    ]),
    "",
    "✨ *Hasa_2_bot | Command Center*"
  ].join("\n");
}

function makeSettingsMenu(config, prefix) {
  const current = key => isEnabled(config[key]) ? "🟢 ON" : "🔴 OFF";
  return [
    "⚙️ *HASA 2 BOT SETTINGS*",
    "╭── 🤖 AUTOMATIONS",
    "│",
    "├─ *[1] AUTO REPLY*",
    "│  1.1 | Enable  " + (current("autoReply") === "🟢 ON" ? "🟢" : ""),
    "│  1.2 | Disable",
    "│",
    "├─ *[2] AUTO STATUS SEEN*",
    "│  2.1 | Enable  " + (current("autoStatusSeen") === "🟢 ON" ? "🟢" : ""),
    "│  2.2 | Disable",
    "│",
    "├─ *[9] STATUS REACTION*",
    "│  9.1 | Green Heart 💚  " + (config.statusReact === "green" ? "🟢" : ""),
    "│  9.2 | Random Emoji 🎲  " + (config.statusReact === "random" ? "🟢" : ""),
    "│  9.3 | Disable Status React",
    "│",
    "├─ *[3] ANTI-DELETE*",
    "│  3.1 | Enable  " + (current("antiDelete") === "🟢 ON" ? "🟢" : ""),
    "│  3.2 | Disable",
    "│",
    "├─ *[4] VIEW ONCE*",
    "│  4.1 | Enable  " + (current("viewOnce") === "🟢 ON" ? "🟢" : ""),
    "│  4.2 | Disable",
    "│",
    "├─ *[5] AI CHAT*",
    "│  5.1 | Enable  " + (current("aiChat") === "🟢 ON" ? "🟢" : ""),
    "│  5.2 | Disable",
    "│",
    "├─ *[6] GROUP COMMANDS*",
    "│  6.1 | Enable  " + (current("groupCommands") === "🟢 ON" ? "🟢" : ""),
    "│  6.2 | Disable",
    "│",
    "├─ *[7] TYPING PRESENCE*",
    "│  7.1 | Enable  " + (current("composing") === "🟢 ON" ? "🟢" : ""),
    "│  7.2 | Disable",
    "│",
    "└─ *[8] AUTO VOICE*",
    "   8.1 | Enable  " + (current("autoVoice") === "🟢 ON" ? "🟢" : ""),
    "   8.2 | Disable",
    "",
    "📌 *Setting එක ON/OFF කිරීමට අදාල අංකය Reply කරන්න.*",
    "🔹 Prefix commands: " + prefix + "settings"
  ].join("\n");
}

export default async function core({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const sender = message.key.participant || jid;
  const body = getBody(message).trim();
  if (!body) return;

  const prefix = config.prefix || ".";
  const owner = isOwner(sender, message, config);
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });
  const quotedBody = getQuotedBody(message).toUpperCase();

  // Number replies are accepted only when replying to this bot's menu/settings panel.
  if (/^\d+(?:\.\d+)?$/.test(body)) {
    if (quotedBody.includes("COMMANDS PANEL") || quotedBody.includes("LIST MENU")) {
      const category = CATEGORIES[body];
      if (!category) return send("❌ ඒ Menu අංකය හමු වුණේ නැහැ. .menu යවලා නැවත තෝරන්න.");
      const caption = [
        "╭━━━〔 " + category[0] + " 〕━━━┈",
        ...category[1].map(item => "│► " + item),
        "╰━━━━━━━━━━━━━━━━━━━┈",
        "",
        "📌 ආපසු Main Menu එකට: " + prefix + "menu"
      ].join("\n");
      return sendWithLogo(sock, jid, message, caption, config);
    }

    if (quotedBody.includes("HASA 2 BOT SETTINGS")) {
      if (!owner) return send("⛔ Settings වෙනස් කළ හැක්කේ Ownerට පමණයි.");
      const setting = SETTINGS.find(item => item.id === body);
      if (!setting) return send("❌ ඒ Setting අංකය හමු වුණේ නැහැ. " + prefix + "settings යවන්න.");
      const currentValue = config[setting.key];
      const alreadySelected = typeof setting.value === "boolean"
        ? isEnabled(currentValue) === setting.value
        : String(currentValue || "off").toLowerCase() === String(setting.value).toLowerCase();

      if (alreadySelected) {
        const state = setting.value === false || setting.value === "off" ? "OFF 🔴" : "ON 🟢";
        return send("ℹ️ *" + setting.label + "* දැනටමත් " + state + " කරලා තියෙන්නේ.");
      }

      config[setting.key] = setting.value;
      try {
        saveConfig(config);
      } catch (error) {
        console.error("Numeric setting save failed:", error);
        return send("❌ Setting Save කරන්න බැරි වුණා: " + error.message);
      }
      const enabled = setting.value !== false && setting.value !== "off";
      return send("✅ *" + setting.label + "* " + (enabled ? "Enabled 🟢" : "Disabled 🔴"));
    }
  }

  const isPlainSet = /^set\s+/i.test(body);
  if (!body.startsWith(prefix) && !isPlainSet) return;
  const commandBody = isPlainSet ? body : body.slice(prefix.length).trim();
  const [rawCommand, ...args] = commandBody.split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  const arg = args.join(" ").trim();

  if (command === "apply" || command === "applyy") {
    const imageMessage = getQuotedImage(message);
    if (imageMessage) {
      if (!owner) return send("⛔ Bot Logo එක වෙනස් කළ හැක්කේ Ownerට පමණයි.");
      try {
        await send("⏳ *Bot Logo එක Save කරමින් පවතී...*");
        await downloadLogo(imageMessage);
        config.BOT_LOGO = "./bot_logo.jpg";
        saveConfig(config);
        return send("✅ *Bot Logo එක සාර්ථකව Update වුණා!* දැන් .alive ගහලා බලන්න.");
      } catch (error) {
        console.error("Logo update failed:", error);
        return send("❌ Logo එක Save කරන්න බැරි වුණා: " + error.message);
      }
    }
    const panel = [
      "╭━━〔 ⚙️ *HASA 2 CONTROL PANEL* 〕━━╮",
      "┃ *BOT IDENTITY & APPEARANCE*",
      "┃ 1.1 | Bot Name",
      "┃ 1.2 | Bot Logo",
      "┃ 1.3 | Bot Footer",
      "┃ 1.4 | Alive Message",
      "╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯",
      "",
      "• Logo: Photo එකකට Reply කර .apply යවන්න.",
      "• Name: set 1.1 Hasa 2 Bot",
      "• Footer: set 1.3 Hasa 2 Bot",
      "• Alive: set 1.4 Your message",
      "",
      "🔹 Logo / Text වෙනස් කිරීම Ownerට පමණයි."
    ].join("\n");
    return sendWithLogo(sock, jid, message, panel, config);
  }

  if (command === "set") {
    if (!owner) return send("⛔ මේ වෙනස්කම් කළ හැක්කේ Ownerට පමණයි.");
    const [setting, ...valueParts] = args;
    const value = valueParts.join(" ").trim();
    if (!setting || !["1.1", "1.3", "1.4"].includes(setting)) {
      return send("භාවිතය:\nset 1.1 Bot Name\nset 1.3 Footer\nset 1.4 Alive Message");
    }
    if (!value) return send("❌ අලුත් අගය ඇතුළත් කරන්න. උදා: set " + setting + " Hasa 2 Bot");
    if (setting === "1.1") {
      config.BOT_NAME = value;
      config.botName = value;
    } else if (setting === "1.3") config.FOOTER = value;
    else config.ALIVE_MSG = value;
    try {
      saveConfig(config);
      return send("✅ *Setting [" + setting + "] Update වුණා:* " + value);
    } catch (error) {
      console.error("Appearance setting save failed:", error);
      return send("❌ Setting Save කරන්න බැරි වුණා: " + error.message);
    }
  }

  if (command === "menu" || command === "help") {
    return sendWithLogo(sock, jid, message, makeMainMenu(config), config);
  }

  if (command === "list" || command === "listcmd" || command === "listcommands") {
    return sendWithLogo(sock, jid, message, makeCommandList(config, prefix), config);
  }

  if (command === "ping") return send("🏓 *PONG!*\nHasa_2_bot is active.");

  if (command === "alive") {
    const botName = config.BOT_NAME || config.botName || "Hasa_2_bot";
    const aliveText = config.ALIVE_MSG || "Your WhatsApp assistant is active and ready to serve.";
    const uptimeSeconds = Math.floor(process.uptime());
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptime = [
      days ? days + "d" : "",
      hours ? hours + "h" : "",
      minutes ? minutes + "m" : "",
      seconds + "s"
    ].filter(Boolean).join(" ");
    const connectionStatus = sock.user ? "Connected 🟢" : "Active 🟡";
    const caption = [
      "╭━━〔 🤖 *HASA 2 BOT* 〕━━╮",
      "",
      "        ✅ *SYSTEM ONLINE*",
      "     ⚡ ALL SYSTEMS OPERATIONAL",
      "",
      aliveText,
      "",
      "╭──〔 📡 *BOT STATUS* 〕",
      "│ 🤖 *Bot:* " + botName,
      "│ 🟢 *Status:* " + connectionStatus,
      "│ ⏱️ *Uptime:* " + uptime,
      "╰━━━━━━━━━━━━━━━━━━",
      "",
      "╭──〔 👑 *BOT OWNERS* 〕",
      "│ Hasantha S Bandara",
      "│ Amandi C Priyadarshani",
      "╰━━━━━━━━━━━━━━━━━━",
      "",
      config.FOOTER ? "_" + config.FOOTER + "_" : "⚡ *POWERED BY HASA 2 BOT* ❤️"
    ].join("\\n");
    return sendWithLogo(sock, jid, message, caption, config);
  }

  if (command === "settings" || command === "setting") {
    if (!owner) return send("⛔ Owner only.");
    return send(makeSettingsMenu(config, prefix));
  }

  if (command === "statusreact") {
    if (!owner) return send("⛔ Status reaction setting එක වෙනස් කළ හැක්කේ Ownerට පමණයි.");
    const mode = arg.toLowerCase();
    if (!["green", "random", "off"].includes(mode)) {
      return send("භාවිතය: " + prefix + "statusreact green | random | off");
    }
    config.statusReact = mode;
    try {
      saveConfig(config);
    } catch (error) {
      console.error("Status reaction config save failed:", error.message);
      return send("❌ Status reaction setting save කරන්න බැරි වුණා: " + error.message);
    }
    const label = mode === "green" ? "Green Heart 💚" : mode === "random" ? "Random Emoji 🎲" : "OFF 🔴";
    return send("✅ *Status Reaction:* " + label);
  }

  if (command === "autoreply" || command === "statusseen" ||
      command === "antidelete" || command === "viewonce" ||
      command === "aichat" || command === "groupcmd" ||
      command === "composing" || command === "autovoice") {
    if (!owner) return send("⛔ මේ setting එක වෙනස් කළ හැක්කේ Ownerට පමණයි.");
    if (!["on", "off"].includes(arg.toLowerCase())) {
      return send("භාවිතය: " + prefix + command + " on/off\n\n" + makeSettingsMenu(config, prefix));
    }
    const keyMap = {
      autoreply: "autoReply",
      statusseen: "autoStatusSeen",
      antidelete: "antiDelete",
      viewonce: "viewOnce",
      aichat: "aiChat",
      groupcmd: "groupCommands",
      composing: "composing",
      autovoice: "autoVoice"
    };
    config[keyMap[command]] = arg.toLowerCase() === "on";
    try {
      saveConfig(config);
    } catch (error) {
      console.error("Config save failed:", error.message);
      return send("❌ Setting save කරන්න බැරි වුණා: " + error.message);
    }
    return send("✅ *" + command + "* " + (arg.toLowerCase() === "on" ? "ON 🟢" : "OFF 🔴") + "\n\n" + makeSettingsMenu(config, prefix));
  }
}
