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
const FALLBACK_MODEL = "gemini-3.5-flash-lite";
const RETRYABLE_STATUS = new Set([408, 500, 502, 503, 504]);

function errorStatus(error) {
  const direct = Number(error?.status || error?.statusCode || error?.response?.status);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const match = String(error?.message || error).match(/(?:HTTP|status|code)[^0-9]{0,12}(408|429|500|502|503|504)\b/i);
  return match ? Number(match[1]) : 0;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(client, modelName, prompt) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt, { timeout: 60000 });
      const answer = result.response.text();
      if (!answer) throw new Error("Gemini returned an empty response.");
      return answer;
    } catch (error) {
      lastError = error;
      const status = errorStatus(error);
      if (!RETRYABLE_STATUS.has(status) || attempt === 2) break;
      await sleep(2000 * (2 ** attempt) + Math.floor(Math.random() * 500));
    }
  }
  throw lastError;
}

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
    const primaryModel = RETIRED_MODELS.has(configuredModel) ? DEFAULT_MODEL : configuredModel;
    const client = new GoogleGenerativeAI(key);
    let answer;
    try {
      answer = await generateWithRetry(client, primaryModel, prompt);
    } catch (primaryError) {
      const status = errorStatus(primaryError);
      if (primaryModel === FALLBACK_MODEL || ![408, 500, 502, 503, 504].includes(status)) throw primaryError;
      answer = await generateWithRetry(client, FALLBACK_MODEL, prompt);
    }
    await sock.sendMessage(jid, { text: answer }, { quoted: message });
  } catch (error) {
    const detail = String(error?.message || error).replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]").slice(0, 240);
    await sock.sendMessage(jid, { text: "❌ Gemini AI error: " + detail }, { quoted: message });
  }
}
