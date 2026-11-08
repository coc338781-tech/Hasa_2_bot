const DICTIONARY_API = "https://api.dictionaryapi.dev/api/v2/entries/en/";
const TRANSLATE_API = "https://api.mymemory.translated.net/get";

export function parseTranslationInput(input) {
  const value = String(input || "").trim();
  if (!value) throw new Error("භාවිතය: .trt [language] text");
  const match = value.match(/^([a-z]{2,5})\s+([\s\S]+)$/i);
  return match ? { target: match[1].toLowerCase(), text: match[2].trim() } : { target: "si", text: value };
}

export async function lookupDictionary(word, fetchImpl = globalThis.fetch) {
  const query = String(word || "").trim();
  if (!/^[a-z][a-z '-]{0,59}$/i.test(query)) throw new Error("English වචනයක් ඇතුළත් කරන්න (අකුරු 60 දක්වා).");
  const response = await fetchImpl(DICTIONARY_API + encodeURIComponent(query), {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000)
  });
  if (response.status === 404) throw new Error("මේ වචනය Dictionary එකේ හමු වුණේ නැහැ.");
  if (!response.ok) throw new Error("Dictionary සේවාව තාවකාලිකව ලබාගත නොහැක.");
  const data = await response.json();
  const entry = Array.isArray(data) ? data[0] : null;
  if (!entry) throw new Error("මේ වචනයට අර්ථයක් හමු වුණේ නැහැ.");
  const meanings = (entry.meanings || []).slice(0, 3).map(meaning => {
    const definitions = (meaning.definitions || []).slice(0, 2)
      .map(item => "• " + item.definition + (item.example ? "\n  උදා: " + item.example : ""));
    return "*" + (meaning.partOfSpeech || "Meaning") + "*\n" + definitions.join("\n");
  }).filter(Boolean);
  const phonetic = entry.phonetic || entry.phonetics?.find(item => item.text)?.text || "";
  return ["📖 *DICTIONARY: " + query + "*", phonetic ? "_" + phonetic + "_" : "", "", ...meanings, "", "⚡ *HASA 2 BOT*"]
    .filter(Boolean).join("\n").slice(0, 3500);
}

export async function translateText(input, fetchImpl = globalThis.fetch) {
  const { target, text } = parseTranslationInput(input);
  if (!/^[a-z]{2,5}$/i.test(target)) throw new Error("Language code එක නිවැරදි නැහැ. උදා: si, en, ta.");
  if (!text) throw new Error("පරිවර්තනය කිරීමට වචන ඇතුළත් කරන්න.");
  if (text.length > 500) throw new Error("එක් වරකට අකුරු 500ක් දක්වා පමණක් පරිවර්තනය කළ හැක.");
  const url = new URL(TRANSLATE_API);
  url.searchParams.set("q", text);
  url.searchParams.set("langpair", "autodetect|" + target);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) throw new Error("Translation සේවාව තාවකාලිකව ලබාගත නොහැක.");
  const data = await response.json();
  const translated = data?.responseData?.translatedText;
  if (!translated || data?.responseStatus >= 400) throw new Error("පරිවර්තනය ලබාගත නොහැකි වුණා.");
  return ["🌐 *TRANSLATION*", "", "🎯 Language: *" + target + "*", "📝 Original: " + text, "",
    "✅ *Translation:*", translated, "", "⚡ *HASA 2 BOT*"].join("\n");
}

export default async function languageTools({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = message.message?.conversation || message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption || message.message?.videoMessage?.caption || "";
  const prefix = config.prefix || ".";
  if (!body.trim().startsWith(prefix)) return;
  const rest = body.trim().slice(prefix.length).trim();
  const space = rest.search(/\s/);
  const command = (space < 0 ? rest : rest.slice(0, space)).toLowerCase();
  const query = space < 0 ? "" : rest.slice(space).trim();
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });
  if (command === "dictionary" || command === "dict") {
    if (!query) return send("📖 භාවිතය: " + prefix + "dictionary hello");
    try { return send(await lookupDictionary(query)); }
    catch (error) { return send("❌ " + error.message); }
  }
  if (command === "trt") {
    if (!query) return send("🌐 භාවිතය: " + prefix + "trt [language] text\nඋදා: " + prefix + "trt si Hello, how are you?");
    try { return send(await translateText(query)); }
    catch (error) { return send("❌ " + error.message); }
  }
}
