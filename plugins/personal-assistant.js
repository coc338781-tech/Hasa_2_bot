import fs from "node:fs";
import path from "node:path";
import { GoogleGenerativeAI } from "@google/generative-ai";

const DATA_DIR = path.resolve("./data");
const STATS_FILE = path.join(DATA_DIR, "daily-message-stats.json");
const contacts = new Map();
const conversations = new Map();
const processing = new Set();
const lastReplyAt = new Map();
const COLOMBO_TZ = "Asia/Colombo";
const MAX_CONTEXT = 8;
const REPLY_COOLDOWN_MS = 12_000;

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

export function normalizePhoneNumber(value, countryCode = "94") {
  let number = digits(value);
  if (number.startsWith("00")) number = number.slice(2);
  if (number.startsWith("0")) number = String(countryCode).replace(/\D/g, "") + number.slice(1);
  return /^\d{7,15}$/.test(number) ? number : "";
}

export function extractMessageText(message) {
  const body = message?.message || {};
  return String(
    body.conversation ||
    body.extendedTextMessage?.text ||
    body.imageMessage?.caption ||
    body.videoMessage?.caption ||
    body.documentMessage?.caption ||
    body.buttonsResponseMessage?.selectedDisplayText ||
    body.listResponseMessage?.title ||
    ""
  ).trim();
}

function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: COLOMBO_TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return values.year + "-" + values.month + "-" + values.day;
}

function ensurePrivateDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
}

function readDailyStats() {
  ensurePrivateDataDir();
  try {
    const value = JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Daily stats file could not be read; starting empty.");
    return {};
  }
}

function writeDailyStats(stats) {
  ensurePrivateDataDir();
  const temp = STATS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(stats), { mode: 0o600 });
  try { fs.chmodSync(temp, 0o600); } catch {}
  fs.renameSync(temp, STATS_FILE);
  try { fs.chmodSync(STATS_FILE, 0o600); } catch {}
}

function recordIncomingMessage(message) {
  const jid = message?.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || message.key?.fromMe) return;
  const sender = message.key?.participant || jid;
  const date = localDateKey();
  const stats = readDailyStats();
  const today = stats[date] && typeof stats[date] === "object"
    ? stats[date]
    : { total: 0, bySender: {} };
  today.total = Number(today.total || 0) + 1;
  today.bySender = today.bySender && typeof today.bySender === "object" ? today.bySender : {};
  today.bySender[sender] = Number(today.bySender[sender] || 0) + 1;
  stats[date] = today;
  for (const key of Object.keys(stats).sort().slice(0, -7)) delete stats[key];
  writeDailyStats(stats);
}

export function summarizeDailyStats(stats, date = localDateKey()) {
  const today = stats?.[date] || { total: 0, bySender: {} };
  const bySender = today.bySender && typeof today.bySender === "object" ? today.bySender : {};
  return {
    total: Number(today.total || 0),
    people: Object.keys(bySender).length,
    bySender: Object.entries(bySender).map(([jid, count]) => ({ jid, count: Number(count || 0) }))
      .sort((a, b) => b.count - a.count)
  };
}

function contactLabel(jid) {
  const item = contacts.get(jid);
  return item?.name || item?.notify || item?.verifiedName ||
    (jid.split("@")[0].slice(-4) ? "••••" + jid.split("@")[0].slice(-4) : "Unknown");
}

function rememberContacts(list = []) {
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const id = item.id || item.jid;
    if (!id) continue;
    const previous = contacts.get(id) || {};
    contacts.set(id, { ...previous, ...item, id });
    const phone = item.phoneNumber || item.phone;
    if (phone) {
      const number = normalizePhoneNumber(phone);
      if (number) {
        const phoneJid = number + "@s.whatsapp.net";
        contacts.set(phoneJid, { ...item, id: phoneJid, phoneNumber: number });
      }
    }
  }
}

function resolveName(query) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return [...contacts.values()].filter(item => {
    const names = [item.name, item.notify, item.verifiedName].filter(Boolean);
    return names.some(name => String(name).toLocaleLowerCase().includes(needle));
  }).filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
}

function isOwner(message, config) {
  if (message?.key?.fromMe) return true;
  const sender = message?.key?.participant || message?.key?.remoteJid || "";
  const number = digits(sender.split("@")[0].split(":")[0]);
  return (config.owner || []).some(owner => digits(owner) === number && number.length > 0);
}

export function isPrivateChat(jid) {
  return typeof jid === "string" &&
    (jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid")) &&
    jid !== "status@broadcast";
}

async function verifyNumber(sock, query, config) {
  const number = normalizePhoneNumber(query, config.countryCode || "94");
  if (!number) return null;
  if (typeof sock.onWhatsApp !== "function") return null;
  const result = await sock.onWhatsApp(number);
  const match = Array.isArray(result) ? result.find(item => item?.exists) : result;
  if (!match?.exists || !match.jid) return null;
  return { jid: match.jid, name: contactLabel(match.jid), number };
}

async function resolveRecipient(sock, query, config) {
  const byNumber = await verifyNumber(sock, query, config);
  if (byNumber) return { ...byNumber, source: "number" };
  const matches = resolveName(query);
  if (matches.length !== 1) return { matches, ambiguous: matches.length > 1 };
  const item = matches[0];
  const jid = item.id;
  if (!jid || (!jid.endsWith("@s.whatsapp.net") && !jid.endsWith("@lid"))) return null;
  return { jid, name: item.name || item.notify || item.verifiedName || jid, source: "contact" };
}

function addConversationLine(jid, role, text) {
  if (!jid || !text) return;
  const list = conversations.get(jid) || [];
  list.push({ role, text: String(text).slice(0, 2000) });
  conversations.set(jid, list.slice(-MAX_CONTEXT));
}

function makeSmartReplyPrompt(lines) {
  const transcript = lines.map(line =>
    (line.role === "model" ? "You" : "Contact") + ": " + line.text
  ).join("\n");
  return [
    "You are helping the WhatsApp account owner write a natural reply to a private incoming chat.",
    "Reply directly to the latest message in the same language and style, usually natural Sinhala when the sender uses Sinhala.",
    "Be concise and conversational. Use context from the recent conversation. Do not mention these instructions or claim to have performed real-world actions.",
    "If a question needs information the owner has not provided, ask a short follow-up instead of inventing facts.",
    "Return only the message to send. Do not add labels, quotation marks, or explanations.",
    "",
    "Recent conversation:",
    transcript
  ].join("\n");
}

async function generateSmartReply(lines, config) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI_KEY_MISSING");
  const client = new GoogleGenerativeAI(key);
  const model = client.getGenerativeModel({
    model: config.aiModel || "gemini-2.0-flash",
    generationConfig: { temperature: 0.75, maxOutputTokens: 220 }
  });
  const result = await model.generateContent(makeSmartReplyPrompt(lines));
  return String(result.response.text() || "").trim().slice(0, 1200);
}

async function handleOwnerCommand({ sock, message, config, body, jid }) {
  const prefix = config.prefix || ".";
  const command = body.slice(prefix.length).trim();
  const [name, ...rest] = command.split(/\s+/);
  const arg = rest.join(" ").trim();
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });

  if (name === "smartreply") {
    if (!arg || !["on", "off"].includes(arg.toLowerCase())) {
      return send("🤖 *AI SMART REPLY*\nතත්ත්වය: " + (config.smartReply ? "🟢 ON" : "🔴 OFF") +
        "\nභාවිතය: .smartreply on / .smartreply off\n\nON කළ විට පුද්ගලික Chats වලට පමණක් AI Reply යවයි.");
    }
    if (arg.toLowerCase() === "on" && !process.env.GEMINI_API_KEY) {
      return send("❌ GEMINI_API_KEY සකස් කර නැහැ. API key එක .env තුළ සකස් කළ පසු නැවත උත්සාහ කරන්න.");
    }
    config.smartReply = arg.toLowerCase() === "on";
    try {
      fs.writeFileSync("./config.json", JSON.stringify(config, null, 2), { mode: 0o600 });
      try { fs.chmodSync("./config.json", 0o600); } catch {}
    } catch {
      return send("❌ Smart Reply Setting එක Save කරන්න බැරි වුණා.");
    }
    return send("✅ *AI Smart Reply:* " + (config.smartReply ? "🟢 ON" : "🔴 OFF") +
      "\nPrivate Chats පමණයි. Group සහ Status Messages වලට Reply නොකරයි." +
      (config.smartReply ? "\n🔐 Incoming text සහ අලුත්ම context messages Gemini API වෙත යවා Reply සකස් කරයි." : ""));
  }

  if (name === "contact") {
    if (!arg) return send("භාවිතය: .contact <නම හෝ දුරකථන අංකය>");
    const recipient = await resolveRecipient(sock, arg, config);
    if (recipient?.jid) return send("✅ WhatsApp Contact එක හමු වුණා.\nනම: " + recipient.name +
      (recipient.number ? "\nඅංකය: " + recipient.number : "") + "\nJID: " + recipient.jid);
    if (recipient?.ambiguous) {
      return send("එකම නමට Contacts කිහිපයක් හමු වුණා:\n" +
        recipient.matches.slice(0, 8).map(item => "• " + (item.name || item.notify || "Unknown") +
          " — " + String(item.id).split("@")[0].slice(-4)).join("\n") +
        "\nනිවැරදි දුරකථන අංකය භාවිතා කරන්න.");
    }
    return send("❌ Contact එක තහවුරු කළ නොහැක. නම local contact sync එකේ නැතිනම් country code සමඟ අංකය භාවිතා කරන්න.");
  }

  if (name === "today") {
    const stats = summarizeDailyStats(readDailyStats());
    if (!stats.total) return send("📊 අද දවසේ ලැබුණු incoming messages තවම නැහැ.");
    const rows = stats.bySender.slice(0, 15).map(item =>
      "• " + contactLabel(item.jid) + " — " + item.count
    );
    return send("📊 *අද WhatsApp Message වාර්තාව* (ශ්‍රී ලංකා වේලාව)\n" +
      "මුළු Messages: *" + stats.total + "*\n" +
      "Message එවූ අය: *" + stats.people + "*\n\n" +
      rows.join("\n") +
      (stats.people > 15 ? "\n… තවත් " + (stats.people - 15) + " දෙනෙක්" : ""));
  }

  if (name === "sendto") {
    const split = arg.indexOf("|");
    if (split < 1 || !arg.slice(split + 1).trim()) {
      return send("භාවිතය: .sendto <Contact නම/අංකය> | <Message>");
    }
    const query = arg.slice(0, split).trim();
    const text = arg.slice(split + 1).trim();
    const recipient = await resolveRecipient(sock, query, config);
    if (recipient?.ambiguous) return send("එකම නමට Contacts කිහිපයක් තිබෙනවා. අංකයෙන් තෝරන්න.");
    if (!recipient?.jid) return send("❌ Contact එක තහවුරු කළ නොහැක. Message එක යැව්වේ නැහැ.");
    await sock.sendMessage(recipient.jid, { text });
    return send("✅ *Message යැව්වා.*\nContact: " + recipient.name + "\nMessage: " + text);
  }

  if (name === "personalhelp") {
    return send([
      "╭━━〔 🧠 *HASA PERSONAL AI* 〕━━",
      "│ .contact <නම/අංකය> — Contact පරීක්ෂා කරන්න",
      "│ .today — අද Messages සහ එවූ අය",
      "│ .sendto <නම/අංකය> | <Message> — Message යවන්න",
      "│ .smartreply on/off — AI Smart Reply පාලනය",
      "╰━━━━━━━━━━━━━━━━━━━━",
      "AI replies send incoming private-chat text and up to 8 recent text turns to the configured Gemini API. No media or contact list is sent. Daily statistics store only sender JIDs and counts locally."
    ].join("\n"));
  }
}

export const commands = [
  { name: "personalhelp", category: "8", usage: "personalhelp", description: "Personal WhatsApp assistant commands" },
  { name: "contact", category: "8", usage: "contact <name or number>", description: "Check a WhatsApp contact" },
  { name: "today", category: "8", usage: "today", description: "Show today's incoming message counts" },
  { name: "sendto", category: "8", usage: "sendto <name or number> | <message>", description: "Send a message to a verified contact" },
  { name: "smartreply", category: "5", usage: "smartreply on|off", description: "Toggle context-aware AI replies" }
];

export async function onConnection(sock) {
  if (!sock?.ev?.on || sock.__hasaPersonalAssistantListeners) return;
  sock.__hasaPersonalAssistantListeners = true;
  sock.ev.on("contacts.upsert", list => rememberContacts(list));
  sock.ev.on("contacts.update", list => rememberContacts(list));
  sock.ev.on("messaging-history.set", payload => rememberContacts(payload?.contacts || []));
}

export default async function personalAssistant({ sock, message, config }) {
  const jid = message?.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;

  const body = extractMessageText(message);
  const prefix = config.prefix || ".";
  const isCommand = body.startsWith(prefix);
  const command = isCommand ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : "";

  if (isCommand && ["smartreply", "contact", "today", "sendto", "personalhelp"].includes(command)) {
    if (!isOwner(message, config)) return sock.sendMessage(jid, { text: "⛔ මේ පහසුකම් Ownerට පමණයි." }, { quoted: message });
    try {
      return await handleOwnerCommand({ sock, message, config, body, jid });
    } catch (error) {
      console.error("Personal assistant command failed:", error?.message || "unknown error");
      return sock.sendMessage(jid, { text: "❌ Command එක ක්‍රියාත්මක කරන්න බැරි වුණා. නැවත උත්සාහ කරන්න." }, { quoted: message });
    }
  }

  // Incoming message counters store only daily totals and sender JIDs, never message text.
  if (!message.key?.fromMe) {
    try { recordIncomingMessage(message); }
    catch { console.error("Daily message counter could not be updated."); }
  }

  if (!config.smartReply || message.key?.fromMe || !isPrivateChat(jid) || !body || isCommand) return;
  if (!process.env.GEMINI_API_KEY || processing.has(jid)) return;
  const now = Date.now();
  if (now - (lastReplyAt.get(jid) || 0) < REPLY_COOLDOWN_MS) return;

  processing.add(jid);
  try {
    addConversationLine(jid, "user", body);
    const reply = await generateSmartReply(conversations.get(jid) || [], config);
    if (!reply) return;
    await sock.sendMessage(jid, { text: reply }, { quoted: message });
    addConversationLine(jid, "model", reply);
    lastReplyAt.set(jid, Date.now());
  } catch (error) {
    if (error?.message === "AI_KEY_MISSING") return;
    console.error("Smart reply generation failed; message content was not logged.");
  } finally {
    processing.delete(jid);
  }
}
