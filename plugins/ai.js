import { GoogleGenerativeAI } from "@google/generative-ai";
export default async function ai({ sock, message, config }) {
  const jid = message.key.remoteJid;
  const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
  const prefix = config.prefix || ".";
  if (!text.startsWith(prefix+"ai ")) return;
  const prompt = text.slice((prefix+"ai ").length).trim();
  const key = process.env.GEMINI_API_KEY;
  if (!key || !config.aiChat) return sock.sendMessage(jid,{text:"AI chat is disabled. Set GEMINI_API_KEY and aiChat=true."},{quoted:message});
  try {
    const ai = new GoogleGenerativeAI(key);
    const model = ai.getGenerativeModel({model:config.aiModel || "gemini-2.0-flash"});
    const result = await model.generateContent(prompt);
    await sock.sendMessage(jid,{text:result.response.text()},{quoted:message});
  } catch(error) { await sock.sendMessage(jid,{text:"AI error: "+error.message},{quoted:message}); }
}
