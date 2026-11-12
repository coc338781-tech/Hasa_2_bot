import { GoogleGenerativeAI } from "@google/generative-ai";

const RETIRED_MODELS = new Set([
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
]);
const DEFAULT_MODEL = "gemini-3.8-flash";

export default async function ai({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  if (!text.startsWith(prefix + "ai ")) return;
  const prompt = text.slice((prefix + "ai ").length).trim();
  const key = process.env.GEMINI_API_KEY;
  if (!key || !config.aiChat) {
    return sock.sendMessage(jid, { text: "AI chat is disabled. Set GEMINI_API_KEY and aiChat=true." }, { quoted: message });
  }
  if (!prompt) {
    return sock.sendMessage(jid, { text: "Usage: " + prefix + "ai <question>" }, { quoted: message });
  }
  try {
    const configuredModel = String(config.aiModel || DEFAULT_MODEL).trim();
    const modelName = RETIRED_MODELS.has(configuredModel) ? DEFAULT_MODEL : configuredModel;
    const client = new GoogleGenerativeAI(key);
    const model = client.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt, { timeout: 60000 });
    const answer = result.response.text();
    if (!answer) throw new Error("Gemini returned an empty response.");
    await sock.sendMessage(jid, { text: answer }, { quoted: message });
  } catch (error) {
    const detail = String(error?.message || error).replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]").slice(0, 240);
    await sock.sendMessage(jid, { text: "❌ Gemini AI error: " + detail }, { quoted: message });
  }
}
