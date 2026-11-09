const EMOJIS = ["❤️", "🔥", "👍", "😂", "💯", "😍"];
function bodyOf(message) {
  return message.message?.conversation || message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption || message.message?.videoMessage?.caption || "";
}
function isOwner(message, jid, config) {
  if (message.key?.fromMe) return true;
  const sender = String(message.key?.participant || jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  return (config.owner || []).some(n => String(n).replace(/\D/g, "") === sender);
}
function weatherText(code) {
  if (code === 0) return "Clear sky";
  if ([1, 2, 3].includes(code)) return "Mainly clear / partly cloudy";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "Unknown conditions";
}
async function weather(city) {
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.searchParams.set("name", city);
  geoUrl.searchParams.set("count", "1");
  geoUrl.searchParams.set("language", "en");
  geoUrl.searchParams.set("format", "json");
  const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(12000) });
  if (!geoRes.ok) throw new Error("Weather location lookup failed");
  const place = (await geoRes.json()).results?.[0];
  if (!place) throw new Error("නගරය හමු වුණේ නැහැ.");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", place.latitude);
  url.searchParams.set("longitude", place.longitude);
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Weather service unavailable");
  const current = (await res.json()).current;
  return [
    "🌦️ *WEATHER: " + place.name + (place.country ? ", " + place.country : "") + "*",
    "",
    "🌡️ Temperature: *" + current.temperature_2m + "°C*",
    "🤗 Feels like: " + current.apparent_temperature + "°C",
    "☁️ Conditions: " + weatherText(current.weather_code),
    "💧 Humidity: " + current.relative_humidity_2m + "%",
    "🌧️ Precipitation: " + current.precipitation + " mm",
    "💨 Wind: " + current.wind_speed_10m + " km/h",
    "",
    "Data: Open-Meteo"
  ].join("\n");
}
function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
async function movie(query) {
  const url = "https://api.tvmaze.com/search/shows?q=" + encodeURIComponent(query);
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error("Movie database unavailable");
  const results = await res.json();
  const show = results?.[0]?.show;
  if (!show) throw new Error("මේ නමට ගැළපෙන චිත්‍රපට / TV show එකක් හමු වුණේ නැහැ.");
  return [
    "🎬 *" + show.name + "*",
    "",
    "📺 Type: " + (show.type || "N/A"),
    "🎭 Genres: " + ((show.genres || []).join(", ") || "N/A"),
    "⭐ Rating: " + (show.rating?.average ?? "N/A"),
    "📅 Premiered: " + (show.premiered || "N/A"),
    "📌 Status: " + (show.status || "N/A"),
    "",
    stripHtml(show.summary).slice(0, 900) || "No summary available.",
    "",
    show.url || ""
  ].filter(Boolean).join("\n");
}
export default async function extraTools({ sock, message, config }) {
  const jid = message.key?.remoteJid;
  if (!jid || jid === "status@broadcast") return;
  const body = bodyOf(message).trim();
  const prefix = config.prefix || ".";
  const lower = body.toLowerCase();
  if (lower.startsWith(prefix + "autoreact")) {
    if (!isOwner(message, jid, config)) return sock.sendMessage(jid, { text: "⛔ Owner only." }, { quoted: message });
    const mode = lower.slice((prefix + "autoreact").length).trim();
    if (!["on", "off"].includes(mode)) return sock.sendMessage(jid, { text: "භාවිතය: " + prefix + "autoreact on/off" }, { quoted: message });
    config.autoReact = mode === "on";
    await fs.writeFile("./config.json", JSON.stringify(config, null, 2));
    return sock.sendMessage(jid, { text: "✅ Auto React " + (config.autoReact ? "ON 🟢" : "OFF 🔴") }, { quoted: message });
  }
  if (!body.startsWith(prefix)) {
    if (!message.key?.fromMe && config.autoReact &&
        !message.message?.protocolMessage && !message.message?.reactionMessage) {
      try {
        const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
        await sock.sendMessage(jid, { react: { text: emoji, key: message.key } });
      } catch (error) {
        console.error("Auto react failed:", error.message);
      }
    }
    return;
  }
  const rest = body.slice(prefix.length).trim();
  const split = rest.search(/\s/);
  const command = (split < 0 ? rest : rest.slice(0, split)).toLowerCase();
  const arg = split < 0 ? "" : rest.slice(split).trim();
  const send = text => sock.sendMessage(jid, { text }, { quoted: message });
  if (command === "weather") {
    if (!arg) return send("භාවිතය: " + prefix + "weather Colombo");
    try { return send(await weather(arg)); }
    catch (error) { return send("❌ " + error.message); }
  }
  if (command === "movie") {
    if (!arg) return send("භාවිතය: " + prefix + "movie Interstellar");
    try { return send(await movie(arg)); }
    catch (error) { return send("❌ " + error.message); }
  }
}
