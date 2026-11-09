import fs from "node:fs";
import os from "node:os";
import { downloadContentFromMessage } from "@whiskeysockets/baileys";
import { appendCatalogToHelp, appendCatalogToList, getCategoryCommandLines } from "../lib/command-catalog.js";

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
  "1": ["GENERAL & SYSTEM", [
    ".menu", ".list", ".ping", ".alive", ".uptime", ".system", ".ram", ".fastmode", ".loadavg"
  ]],
  "2": ["AI ASSISTANT", [".ai <question>", ".ask <question>", ".summarize (reply to text)", ".imagine <prompt>", ".translate [language] <text>", ".transcribe (reply to voice)"]],
  "3": ["MEDIA DOWNLOADS", [".dl <public video url>", ".fb <public video url>", ".video <name or url>", ".song <name or url>", ".fbtest", ".save / .dpn / .dapan / .one / .evapan"]],
  "4": ["GROUP MANAGEMENT", [
    ".tagall [message]", ".hidetag [message]", ".promote @user",
    ".demote @user", ".kick @user", ".groupinfo", ".antilink on|off",
    ".warn @user [reason]", ".warnings @user", ".resetwarn @user"
  ]],
  "5": ["AUTOMATIONS", [
    ".settings", ".autoreply on|off", ".statusseen on|off",
    ".statusreact green|random|off", ".antidelete on|off", ".viewonce on|off", ".autoreact on|off",
    ".aichat on|off", ".groupcmd on|off", ".composing on|off", ".autovoice on|off",
    ".addreply word-reply", ".replacereply word-reply", ".getreply",
    ".removereply word", ".resetreply"
  ]],
  "6": ["STICKER & MEDIA TOOLS", [".sticker (reply to photo/video)", ".toaudio (reply to video)", ".compress (reply to video)"]],
  "7": ["PRANK & FUN", [".hack"]],
  "8": ["OWNER CONTROL", [
    ".status", ".system", ".logs", ".backup", ".owner", ".apply", "set 1.1 Bot Name", "set 1.3 Footer", "set 1.4 Alive Message"
  ]],
  "9": ["SUBBOT MANAGER", [
    ".subbot <number>", ".subcheck", ".getsubbot", ".stopsubbot",
    ".restartsubbot", ".delsubbot", ".delallsubbot confirm", ".restartallsubbot", ".helpsubbot"
  ]],
  "10": ["UTILITY TOOLS", [
    ".weather <city>", ".movie <title>", ".quote (reply to message)", ".math <expression>", ".cal <expression>", ".mathstep <expression>",
    ".id", ".jid", ".wame <number> [message]", ".readmore <preview> | <text>", ".fancy <text>",
    ".dictionary <English word>", ".trt [language] <text>", ".translate [language] <text>"
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
    "01  GENERAL & SYSTEM",
    "02  AI ASSISTANT",
    "03  MEDIA DOWNLOADS",
    "04  GROUP MANAGEMENT",
    "05  AUTOMATIONS",
    "06  STICKER & MEDIA TOOLS",
    "07  PRANK & FUN",
    "08  OWNER CONTROL",
    "09  SUBBOT MANAGER",
    "10  UTILITY TOOLS"
  ];
  return [
    "*『 HASA 2 BOT 』*",
    "✦ NEXT GENERATION WHATSAPP MD BOT ✦",
    "",
    "╭━━━〔 🤖 MAIN MENU 〕━━━",
    "┃ 🟢 STATUS: ONLINE",
    "┃ ⚡ RAM: *" + used + "MB / " + total + "MB*",
    "┃ ⏱️ UPTIME: *" + Math.floor(process.uptime() / 60) + " MIN*",
    "┣━━━━━━━━━━━━━━━━━━",
    ...names.map(line => "┃ " + line),
    "╰━━━━━━━━━━━━━━━━━━",
    "",
    "↪ Reply with a category number (1-10)",
    "📜 Full commands: .list",
    "⚙️ Owner settings: .settings",
    "",
    "❤️ *POWERED BY HASA*"
  ].join("\n");
}

function makeCommandList(config, prefix) {
  const groups = [
    ["GENERAL & SYSTEM", [prefix+"menu", prefix+"list", prefix+"ping", prefix+"alive", prefix+"uptime", prefix+"system", prefix+"ram", prefix+"fastmode", prefix+"loadavg"]],
    ["AI ASSISTANT", [prefix+"ai <question>", prefix+"ask <question>", prefix+"summarize (reply to text)", prefix+"imagine <prompt>", prefix+"translate [language] <text>", prefix+"transcribe (reply to voice)"]],
    ["MEDIA DOWNLOADS & STATUS SAVER", [prefix+"dl <public video url>", prefix+"fb <public video url>", prefix+"video <name or url>", prefix+"song <name or url>", prefix+"fbtest", prefix+"save / "+prefix+"dpn / "+prefix+"dapan / "+prefix+"one / "+prefix+"evapan"]],
    ["GROUP MANAGEMENT", [prefix+"tagall [message]", prefix+"hidetag [message]", prefix+"promote @user", prefix+"demote @user", prefix+"kick @user", prefix+"groupinfo", prefix+"antilink on/off", prefix+"warn @user [reason]", prefix+"warnings @user", prefix+"resetwarn @user"]],
    ["AUTOMATIONS & AUTO REPLY", [prefix+"settings", prefix+"autoreply on/off", prefix+"statusseen on/off", prefix+"statusreact green|random|off", prefix+"antidelete on/off", prefix+"viewonce on/off", prefix+"autoreact on/off", prefix+"aichat on/off", prefix+"groupcmd on/off", prefix+"composing on/off", prefix+"autovoice on/off", prefix+"addreply word-reply", prefix+"replacereply word-reply", prefix+"getreply", prefix+"removereply word", prefix+"resetreply"]],
    ["STICKER & MEDIA TOOLS", [prefix+"sticker (reply to photo/video)", prefix+"toaudio (reply to video)", prefix+"compress (reply to video)"]],
    ["PRANK & FUN", [prefix+"hack"]],
    ["OWNER CONTROL", [prefix+"status", prefix+"system", prefix+"logs", prefix+"backup", prefix+"owner", prefix+"statusalias list/add/remove", prefix+"apply", "set 1.1 Bot Name", "set 1.3 Footer", "set 1.4 Alive Message"]],
    ["SUBBOT MANAGER", [prefix+"subbot <number>", prefix+"subcheck", prefix+"getsubbot", prefix+"stopsubbot", prefix+"restartsubbot", prefix+"delsubbot", prefix+"delallsubbot confirm", prefix+"restartallsubbot", prefix+"helpsubbot"]],
    ["UTILITY TOOLS", [prefix+"weather <city>", prefix+"movie <title>", prefix+"quote (reply to message)", prefix+"math <expression>", prefix+"cal <expression>", prefix+"mathstep <expression>", prefix+"id", prefix+"jid", prefix+"wame <number> [message]", prefix+"readmore <preview> | <text>", prefix+"fancy <text>", prefix+"dictionary <English word>", prefix+"trt [language] <text>", prefix+"translate [language] <text>"]]
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

function makeHelpGuide(prefix) {
  return [
    "*📖 HASA 2 BOT — සම්පූර්ණ HELP GUIDE*",
    "",
    "ආයුබෝවන්! 👋 මේ Bot එකේ Commands භාවිතා කරන ආකාරය මෙහි දැක්වේ.",
    "",
    "┏━━〔 🚀 1. ආරම්භය 〕",
    "┃ සියලුම Commands ආරම්භයේ Prefix එක යොදන්න.",
    "┃ Default Prefix: *" + prefix + "*",
    "┃ උදා: " + prefix + "ping",
    "┃",
    "┃ " + prefix + "help  — මෙම උපදෙස්",
    "┃ " + prefix + "menu  — ප්‍රධාන Menu එක",
    "┃ " + prefix + "list  — සම්පූර්ණ Command List එක",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 🤖 2. GENERAL & SYSTEM 〕",
    "┃ " + prefix + "ping — Response Speed පරීක්ෂා කරන්න.",
    "┃ " + prefix + "alive — Bot එක Online ද බලන්න.",
    "┃ " + prefix + "uptime — Bot එක ක්‍රියාත්මක කාලය.",
    "┃ " + prefix + "system / " + prefix + "ram — Server, CPU, RAM සහ Storage විස්තර.",
    "┃ " + prefix + "fastmode — Fast Mode තත්ත්වය.",
    "┃ " + prefix + "loadavg — Server Load Average.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 🧠 3. AI ASSISTANT 〕",
    "┃ " + prefix + "ai <ප්‍රශ්නය> — AI සමඟ කතා කරන්න.",
    "┃ " + prefix + "ask <ප්‍රශ්නය> — AI වෙතින් පිළිතුරක් ගන්න.",
    "┃ " + prefix + "summarize — Text එකකට Reply කර සාරාංශයක් ගන්න.",
    "┃ " + prefix + "summarize <text> — දුන් Text එක සාරාංශ කරන්න.",
    "┃ " + prefix + "imagine <විස්තරය> — විස්තරයෙන් AI Image එකක් සකස් කරන්න.",
    "┃ " + prefix + "translate [භාෂා කේතය] <text> — පරිවර්තනය කරන්න.",
    "┃ " + prefix + "trt [භාෂා කේතය] <text> — පරිවර්තනය සඳහා කෙටි Command එක.",
    "┃ " + prefix + "transcribe — Voice Message එකකට Reply කර Text කරන්න.",
    "┃ උදා: " + prefix + "ask ශ්‍රී ලංකාවේ අගනුවර කුමක්ද?",
    "┃ උදා: " + prefix + "trt si Hello, how are you?",
    "┃ සටහන: AI Commands සඳහා Owner විසින් AI Chat ON කර තිබිය යුතුයි.",
    "┃ Image generation සඳහා Gemini Image API access සහ quota අවශ්‍යයි.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 📥 4. MEDIA DOWNLOADS 〕",
    "┃ " + prefix + "dl <public URL> — සහාය දක්වන Video Link එකක් Download කරන්න.",
    "┃ " + prefix + "fb <public URL> — සහාය දක්වන Facebook Link එකක්.",
    "┃ " + prefix + "video <නම හෝ URL> — Video සෙවීම/ලබාගැනීම.",
    "┃ " + prefix + "song <නම හෝ URL> — Song සෙවීම/ලබාගැනීම.",
    "┃ " + prefix + "fbtest — Facebook Downloader පරීක්ෂාව.",
    "┃ " + prefix + "save / " + prefix + "dpn / " + prefix + "dapan / " + prefix + "one / " + prefix + "evapan — Status එකට Reply එකක් යවා, ඒ Reply ගිය Chat එකේ මේ Command එක යවන්න; Photo/Video එක එම Chat එකට ලැබේ.",
    "┃ Sinhala aliases: " + prefix + "දාපන් / " + prefix + "ඔනේ / " + prefix + "ඕනේ / " + prefix + "සේව් / " + prefix + "එවපන්.",
    "┃ Owner: " + prefix + "statusalias list | add <නම> | remove <නම> — අලුත් Alias එකක් පසුව එක්කරන්න.",
    "┃ සටහන: Public සහ Downloader එකෙන් සහාය දක්වන Links පමණක් භාවිතා කරන්න.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 👥 5. GROUP COMMANDS 〕",
    "┃ " + prefix + "tagall [පණිවිඩය] — Members සියල්ල Tag කරන්න.",
    "┃ " + prefix + "hidetag [පණිවිඩය] — සියල්ලන් Mention කර පණිවිඩය යවන්න.",
    "┃ " + prefix + "promote @user — Member කෙනෙකු Admin කරන්න.",
    "┃ " + prefix + "demote @user — Admin බලතල ඉවත් කරන්න.",
    "┃ " + prefix + "kick @user — Member ඉවත් කරන්න.",
    "┃ " + prefix + "groupinfo — Group විස්තර.",
    "┃ " + prefix + "antilink on/off — Link ආරක්ෂාව පාලනය.",
    "┃ " + prefix + "warn @user [හේතුව] — Warning එකක් දෙන්න.",
    "┃ " + prefix + "warnings @user — Warnings බලන්න.",
    "┃ " + prefix + "resetwarn @user — Warnings Reset කරන්න.",
    "┃ සටහන: Group එකේ Bot එකට අවශ්‍ය Admin අවසර තිබිය යුතුයි.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 ⚙️ 6. SETTINGS & AUTO FEATURES 〕",
    "┃ " + prefix + "settings — Owner Settings Panel එක.",
    "┃ " + prefix + "autoreply on/off — Auto Reply පාලනය.",
    "┃ " + prefix + "statusseen on/off — Auto Status Seen පාලනය.",
    "┃ " + prefix + "statusreact green/random/off — Status Reaction.",
    "┃ " + prefix + "antidelete on/off — Anti Delete පාලනය.",
    "┃ " + prefix + "viewonce on/off — View Once පහසුකම පාලනය.",
    "┃ " + prefix + "aichat on/off — AI Chat සක්‍රීය/අක්‍රීය කරන්න.",
    "┃ " + prefix + "groupcmd on/off — Group Commands පාලනය.",
    "┃ " + prefix + "composing on/off — Typing Presence පාලනය.",
    "┃ " + prefix + "autovoice on/off — Auto Voice පාලනය.",
    "┃ " + prefix + "autoreact on/off — Auto Reaction පාලනය.",
    "┃ මේ Settings වෙනස් කළ හැක්කේ Ownerට පමණයි.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 💬 7. AUTO REPLY 〕",
    "┃ " + prefix + "addreply වචනය|පිළිතුර — අලුත් Reply එකක් එකතු කරන්න.",
    "┃ " + prefix + "replacereply වචනය|පිළිතුර — Reply එකක් වෙනස් කරන්න.",
    "┃ " + prefix + "getreply — සුරැකි Replies බලන්න.",
    "┃ " + prefix + "removereply වචනය — Reply එකක් ඉවත් කරන්න.",
    "┃ " + prefix + "resetreply — Replies Reset කරන්න.",
    "┃ " + prefix + "autoreply on/off — Auto Reply සක්‍රීය/අක්‍රීය කරන්න.",
    "┃ උදා: " + prefix + "addreply hello|Hello! කොහොමද?",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 🎨 8. STICKER & FUN 〕",
    "┃ " + prefix + "sticker / " + prefix + "s — Photo/Video එකකට Reply කර යවන්න.",
    "┃ Status Saver: Status එකට Reply එකක් යවා, ඒ Chat එකේ " + prefix + "save (හෝ වෙනත් Alias එකක්) යවන්න.",
    "┃ " + prefix + "toaudio — Video එකකට Reply කර Audio ලබාගන්න.",
    "┃ " + prefix + "compress — Video එකකට Reply කර Compress කරන්න.",
    "┃ " + prefix + "hack — Fun prank message එක.",
    "┃ Sticker සෑදීමට Server එකේ ffmpeg තිබිය යුතුයි.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 👑 9. OWNER & SUBBOT 〕",
    "┃ " + prefix + "status — Bot Status (Owner only).",
    "┃ " + prefix + "logs — Filter කළ Diagnostic Logs (Owner only).",
    "┃ " + prefix + "backup — Config Backup එකක් ලබාගන්න (Owner only).",
    "┃ " + prefix + "owner — Owner සැකසුම් (Owner only).",
    "┃ " + prefix + "apply — Bot Logo/Appearance සැකසුම්.",
    "┃ set 1.1 <නම> — Bot Name වෙනස් කරන්න.",
    "┃ set 1.3 <පෙළ> — Footer වෙනස් කරන්න.",
    "┃ set 1.4 <පෙළ> — Alive Message වෙනස් කරන්න.",
    "┃ " + prefix + "subbot <number> — Subbot එකක් සම්බන්ධ කරන්න.",
    "┃ " + prefix + "subcheck — Subbot තත්ත්වය බලන්න.",
    "┃ " + prefix + "getsubbot — Subbot විස්තර ලබාගන්න.",
    "┃ " + prefix + "stopsubbot — Subbot නවත්වන්න.",
    "┃ " + prefix + "restartsubbot — Subbot නැවත ආරම්භ කරන්න.",
    "┃ " + prefix + "delsubbot — Subbot ඉවත් කරන්න.",
    "┃ " + prefix + "delallsubbot confirm — සියලු Subbots ඉවත් කරන්න.",
    "┃ " + prefix + "restartallsubbot — සියලු Subbots Restart කරන්න.",
    "┃ " + prefix + "helpsubbot — Subbot උපදෙස්.",
    "┃ Owner Commands භාවිතා කළ හැක්කේ අවසරලත් Ownerට පමණයි.",
    "┃ Backup එකට config පමණක් ඇතුළත් වේ; WhatsApp Session නොවේ.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 🧰 10. UTILITY TOOLS 〕",
    "┃ " + prefix + "weather <නගරය> — වත්මන් කාලගුණය.",
    "┃ " + prefix + "movie <නම> — TV Show තොරතුරු සොයන්න.",
    "┃ " + prefix + "quote — Message එකකට Reply කර Quote කරන්න.",
    "┃ " + prefix + "math <ගණනය> — ගණනයක් කරන්න.",
    "┃ " + prefix + "cal <ගණනය> — Calculator.",
    "┃ " + prefix + "mathstep <ගණනය> — පියවර සමඟ ගණනය.",
    "┃ " + prefix + "id / " + prefix + "jid — Chat/Group ID තොරතුරු.",
    "┃ " + prefix + "wame <අංකය> [පණිවිඩය] — WhatsApp Chat Link.",
    "┃ " + prefix + "readmore <කෙටි පෙළ>|<දිගු පෙළ> — Read More පෙළ.",
    "┃ " + prefix + "fancy <පෙළ> — Fancy Text.",
    "┃ " + prefix + "dictionary / " + prefix + "dict <word> — English අර්ථය.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "┏━━〔 🛠️ 11. ගැටලු විසඳීම 〕",
    "┃ • Command එක ඉදිරියෙන් නිවැරදි Prefix එක යොදන්න.",
    "┃ • Reply අවශ්‍ය Command එකකදී අදාල Photo/Video/Message එකට Reply කරන්න.",
    "┃ • Mention අවශ්‍ය Group Command එකකදී User කෙනෙකු Mention කරන්න.",
    "┃ • Admin අවසර අවශ්‍ය නම් Bot එක Group Admin කරන්න.",
    "┃ • AI වැඩ නොකරන්නේ නම් " + prefix + "aichat on තත්ත්වය Ownerගෙන් පරීක්ෂා කරගන්න.",
    "┃ • තවමත් ගැටලුවක් නම් Bot Owner අමතන්න.",
    "┗━━━━━━━━━━━━━━━━",
    "",
    "❤️ *HASA 2 BOT — YOUR WHATSAPP ASSISTANT*",
    "📜 Commands ලැයිස්තුව: " + prefix + "list",
    "🏠 Main Menu: " + prefix + "menu"
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
  const commandReceivedAt = process.hrtime.bigint();
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
    if (quotedBody.includes("COMMANDS PANEL") || quotedBody.includes("LIST MENU") || quotedBody.includes("MAIN MENU")) {
      const category = CATEGORIES[body];
      if (!category) return send("❌ ඒ Menu අංකය හමු වුණේ නැහැ. .menu යවලා නැවත තෝරන්න.");
      const commandCatalog = globalThis.__hasaPlugins?.commands || [];
      const caption = [
        "╭━━━〔 " + category[0] + " 〕━━━┈",
        ...category[1].map(item => "│► " + item),
        ...getCategoryCommandLines(commandCatalog, body, prefix).map(item => "│► " + item),
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

  if (command === "help") {
    const commandCatalog = globalThis.__hasaPlugins?.commands || [];
    return send(appendCatalogToHelp(makeHelpGuide(prefix), commandCatalog, prefix));
  }

  if (command === "menu") {
    return sendWithLogo(sock, jid, message, makeMainMenu(config), config);
  }

  if (command === "list" || command === "listcmd" || command === "listcommands") {
    const commandCatalog = globalThis.__hasaPlugins?.commands || [];
    return sendWithLogo(sock, jid, message, appendCatalogToList(makeCommandList(config, prefix), commandCatalog, prefix), config);
  }

  if (command === "ping") {
    // Measure bot-side response time and keep the reply compact.
    const elapsedNs = process.hrtime.bigint() - commandReceivedAt;
    const responseMs = Math.max(1, Math.round(Number(elapsedNs) / 1e6));
    return send("⚡ *Ping: " + responseMs + " ms*");
  }

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
    ].join("\n");
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
