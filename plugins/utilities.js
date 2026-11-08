import os from "node:os";

const FUNCTIONS = {
  abs: { fn: Math.abs, min: 1, max: 1 },
  ceil: { fn: Math.ceil, min: 1, max: 1 },
  floor: { fn: Math.floor, min: 1, max: 1 },
  round: { fn: Math.round, min: 1, max: 1 },
  sqrt: { fn: Math.sqrt, min: 1, max: 1 },
  sin: { fn: Math.sin, min: 1, max: 1 },
  cos: { fn: Math.cos, min: 1, max: 1 },
  tan: { fn: Math.tan, min: 1, max: 1 },
  log: { fn: Math.log, min: 1, max: 1 },
  min: { fn: Math.min, min: 1, max: 20 },
  max: { fn: Math.max, min: 1, max: 20 },
  pow: { fn: Math.pow, min: 2, max: 2 }
};

const PRECEDENCE = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };

function tokenize(expression) {
  if (typeof expression !== "string" || !expression.trim()) throw new Error("ගණනය කරන්න අගයක් දෙන්න.");
  if (expression.length > 200) throw new Error("Expression එක අකුරු 200කට වඩා දිගයි.");
  const tokens = [];
  let index = 0;
  const pattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:([eE][+-]?\d+))?|([a-zA-Z]+)|([()+\-*/%^,]))/y;
  while (index < expression.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(expression);
    if (!match) throw new Error("අනුමත නොවන symbol එකක් තියෙනවා.");
    index = pattern.lastIndex;
    if (match[1]) tokens.push({ type: "number", value: Number(match[1] + (match[2] || "")) });
    else if (match[3]) tokens.push({ type: "name", value: match[3].toLowerCase() });
    else tokens.push({ type: "symbol", value: match[4] });
    if (tokens.length > 100) throw new Error("Expression එක වැඩිය සංකීර්ණයි.");
  }
  return tokens;
}

export function evaluateExpression(expression) {
  const tokens = tokenize(expression);
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];

  function primary() {
    const token = take();
    if (!token) throw new Error("ගණනය සම්පූර්ණ නැහැ.");
    if (token.type === "number") return token.value;
    if (token.type === "symbol" && (token.value === "+" || token.value === "-")) {
      const value = expressionAt(3);
      return token.value === "-" ? -value : value;
    }
    if (token.type === "symbol" && token.value === "(") {
      const value = expressionAt(0);
      if (take()?.value !== ")") throw new Error(") වරහන අස්ථානගතයි.");
      return value;
    }
    if (token.type === "name") {
      if (token.value === "pi") return Math.PI;
      if (token.value === "e") return Math.E;
      const definition = FUNCTIONS[token.value];
      if (!definition || take()?.value !== "(") throw new Error("භාවිතා කළ නොහැකි function එකක්: " + token.value);
      const args = [];
      if (peek()?.value !== ")") {
        do {
          args.push(expressionAt(0));
          if (peek()?.value !== ",") break;
          take();
        } while (true);
      }
      if (take()?.value !== ")") throw new Error("Function එකේ ) වරහන අස්ථානගතයි.");
      if (args.length < definition.min || args.length > definition.max) throw new Error(token.value + "() සඳහා arguments ගණන වැරදියි.");
      return definition.fn(...args);
    }
    throw new Error("ගණනයේ format එක වැරදියි.");
  }

  function expressionAt(minimum) {
    let left = primary();
    while (peek()?.type === "symbol" && PRECEDENCE[peek().value] >= minimum) {
      const operator = take().value;
      const precedence = PRECEDENCE[operator];
      const right = expressionAt(precedence + (operator === "^" ? 0 : 1));
      if (operator === "+") left += right;
      else if (operator === "-") left -= right;
      else if (operator === "*") left *= right;
      else if (operator === "/") {
        if (right === 0) throw new Error("බිංදුවෙන් බෙදන්න බැහැ.");
        left /= right;
      } else if (operator === "%") {
        if (right === 0) throw new Error("බිංදුවෙන් බෙදන්න බැහැ.");
        left %= right;
      } else left = left ** right;
    }
    return left;
  }

  const result = expressionAt(0);
  if (position !== tokens.length) throw new Error("Expression එකේ අමතර කොටසක් තියෙනවා.");
  if (!Number.isFinite(result) || Math.abs(result) > 1e100) throw new Error("ප්‍රතිඵලය ගණනය කළ නොහැක.");
  return Object.is(result, -0) ? 0 : result;
}

export function formatFancy(value) {
  return Array.from(String(value), char => {
    const code = char.codePointAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D400 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D41A + code - 97);
    if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7CE + code - 48);
    return char;
  }).join("");
}

export function formatRuntime(seconds) {
  let remaining = Math.max(0, Math.floor(seconds));
  const days = Math.floor(remaining / 86400);
  remaining %= 86400;
  const hours = Math.floor(remaining / 3600);
  remaining %= 3600;
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return [days ? days + "d" : "", hours ? hours + "h" : "", minutes ? minutes + "m" : "", secs + "s"].filter(Boolean).join(" ");
}

function getBody(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}

function cleanJid(value) {
  return String(value || "Unknown").replace(/@s\.whatsapp\.net$/, "").replace(/@g\.us$/, " (group)").replace(/@lid$/, " (LID)");
}

export default async function utilities({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const prefix = config.prefix || ".";
  const body = getBody(message).trim();
  if (!body.startsWith(prefix)) return;
  const [rawCommand, ...args] = body.slice(prefix.length).trim().split(/\s+/);
  const command = (rawCommand || "").toLowerCase();
  const query = args.join(" ").trim();
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });

  if (["math", "cal", "mathstep"].includes(command)) {
    if (!query) return send("🧮 *භාවිතය:* " + prefix + command + " 25 * (4 + 2)\n\nFunctions: sqrt(), abs(), round(), sin(), cos(), min(), max(), pow(), pi, e");
    try {
      const result = evaluateExpression(query);
      const formatted = Number.isInteger(result) ? String(result) : String(Number(result.toPrecision(12)));
      const heading = command === "mathstep" ? "🧾 *MATH STEP*" : "🧮 *CALCULATOR*";
      return send(heading + "\n\nExpression: " + query + "\nResult: *" + formatted + "*\n\n⚡ HASA 2 BOT");
    } catch (error) {
      return send("❌ ගණනය කළ නොහැක: " + error.message);
    }
  }

  if (command === "uptime") {
    return send("⏳ *BOT UPTIME*\n" + formatRuntime(process.uptime()));
  }

  if (command === "ram") {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const mb = value => (value / 1024 / 1024).toFixed(1) + " MB";
    return send("💾 *RAM USAGE*\n\nUsed: " + mb(used) + "\nFree: " + mb(free) + "\nTotal: " + mb(total));
  }

  if (command === "loadavg") {
    const values = os.loadavg().map(value => value.toFixed(2));
    return send("📊 *SERVER LOAD*\n1 min: " + values[0] + "\n5 min: " + values[1] + "\n15 min: " + values[2]);
  }

  if (command === "fastmode") {
    return send("⚡ *FAST MODE:* " + (config.fastMode ? "ON 🟢" : "OFF 🔴"));
  }

  if (command === "fancy") {
    if (!query) return send("භාවිතය: " + prefix + "fancy Your text");
    return send("✨ " + formatFancy(query));
  }

  if (command === "id" || command === "jid") {
    const sender = message.key.participant || jid;
    const quoted = message.message?.extendedTextMessage?.contextInfo?.stanzaId;
    const lines = [
      "🆔 *MESSAGE IDENTIFICATION*",
      "",
      "Chat JID: " + cleanJid(jid),
      "Sender: " + cleanJid(sender),
      "Message ID: " + (message.key.id || "N/A")
    ];
    if (quoted) lines.push("Quoted Message ID: " + quoted);
    return send(lines.join("\n"));
  }

  if (command === "quote") {
    const context = message.message?.extendedTextMessage?.contextInfo;
    const quoted = context?.quotedMessage;
    if (!quoted) return send("📌 Quote කරන්න Message එකකට Reply කර " + prefix + "quote යවන්න.");
    const quotedText = quoted.conversation ||
      quoted.extendedTextMessage?.text ||
      quoted.imageMessage?.caption ||
      quoted.videoMessage?.caption || "[Media message]";
    const author = cleanJid(context.participant || "Unknown");
    return send("╭━━〔 💬 *MESSAGE QUOTE* 〕━━╮\n\n“" + quotedText.slice(0, 2500) + "”\n\n— " + author + "\n╰━━━━━━━━━━━━━━━━━━");
  }
}
