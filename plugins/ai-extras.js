import { recordAiUsage } from "../lib/ai-usage.js";

function getText(message) {
  return message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption || "";
}
function quotedText(message) {
  const q = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  return q?.conversation || q?.extendedTextMessage?.text ||
    q?.imageMessage?.caption || q?.videoMessage?.caption || "";
}
async function geminiText(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const model = process.env.HASA_TEXT_MODEL || "gemini-2.5-flash";
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("Gemini HTTP " + response.status);
  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini returned an empty answer");
  return text;
}
async function groqText(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("Groq fallback unavailable");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      max_completion_tokens: 1200
    }),
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error("Groq HTTP " + response.status);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned an empty answer");
  return text;
}
async function textAnswer(prompt) {
  try {
    const answer = await geminiText(prompt);
    await recordAiUsage("gemini", true);
    return answer;
  } catch (error) {
    await recordAiUsage("gemini", false).catch(() => {});
    console.warn("AI extras Gemini failed; trying Groq fallback:", error.message);
    try {
      const answer = await groqText(prompt);
      await recordAiUsage("groq", true);
      return answer;
    } catch (fallbackError) {
      await recordAiUsage("groq", false).catch(() => {});
      throw fallbackError;
    }
  }
}
async function imagine(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const model = process.env.HASA_IMAGE_MODEL || "gemini-3.1-flash-image";
  const response = await fetch("https://generativelanguage.googleapis.com/v1/models/" +
    encodeURIComponent(model) + ":generateContent", {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Create one high-quality image from this prompt: " + prompt }] }],
      generationConfig: { responseModalities: ["IMAGE"] }
    }),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error("Image generation HTTP " + response.status);
  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const encoded = parts.find(part => part?.inlineData?.data || part?.inline_data?.data);
  const imageData = encoded?.inlineData?.data || encoded?.inline_data?.data;
  if (!imageData) throw new Error("Image model did not return an image");
  return Buffer.from(imageData, "base64");
}
export default async function aiExtras({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast" || message.key?.fromMe) return;
  const body = getText(message).trim();
  const prefix = config.prefix || ".";
  if (!body.startsWith(prefix)) return;
  const rest = body.slice(prefix.length).trim();
  const split = rest.search(/\s/);
  const command = (split < 0 ? rest : rest.slice(0, split)).toLowerCase();
  const arg = split < 0 ? "" : rest.slice(split).trim();
  if (!["ask", "summarize", "imagine"].includes(command)) return;
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });
  if (!config.aiChat) return send("⛔ AI Chat දැනට OFF. Ownerට .aichat on මඟින් ON කළ හැක.");
  if (command === "imagine") {
    if (!arg) return send("භාවිතය: " + prefix + "imagine a beautiful sunset over Sri Lanka");
    await send("🎨 AI image එක සකස් කරමින්...");
    try {
      const image = await imagine(arg);
      return sock.sendMessage(jid, { image, caption: "🎨 *HASA AI IMAGE*" }, { quoted: message });
    } catch (error) {
      console.error("AI image generation failed:", error.message);
      return send("❌ Image එක හදන්න බැරි වුණා. Gemini image API access / quota පරීක්ෂා කරන්න.");
    }
  }
  const source = command === "summarize" ? (quotedText(message) || arg) : arg;
  if (!source) return send(command === "summarize"
    ? "දිගු message එකකට Reply කර " + prefix + "summarize යවන්න, නැත්නම් text එකක් එක් කරන්න."
    : "භාවිතය: " + prefix + "ask ඔබේ ප්‍රශ්නය");
  if (source.length > 12000) return send("❌ Text එක දිග වැඩියි. අකුරු 12,000ක් දක්වා පමණක්.");
  const prompt = command === "summarize"
    ? "Summarize the following text clearly. Preserve key facts and write in the same language as the source:\n\n" + source
    : source;
  await send(command === "summarize" ? "📝 සාරාංශය සකස් කරමින්..." : "🤖 AI පිළිතුර සකස් කරමින්...");
  try {
    const answer = await textAnswer(prompt);
    return send(answer.slice(0, 4000));
  } catch (error) {
    console.error("AI extras request failed:", error.message);
    return send("❌ AI පිළිතුරක් ලබාගන්න බැරි වුණා. Gemini/Groq API සහ quota පරීක්ෂා කරන්න.");
  }
}
