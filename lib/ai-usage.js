import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.resolve("./data/ai-usage.json");
const EMPTY = () => ({ providers: { gemini: { total: 0, success: 0, failed: 0 }, groq: { total: 0, success: 0, failed: 0 } }, lastUsed: null });

export async function getAiUsage(file = FILE) {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const empty = EMPTY();
    for (const provider of ["gemini", "groq"]) {
      const item = data.providers?.[provider] || {};
      empty.providers[provider] = {
        total: Number.isSafeInteger(item.total) ? item.total : 0,
        success: Number.isSafeInteger(item.success) ? item.success : 0,
        failed: Number.isSafeInteger(item.failed) ? item.failed : 0
      };
    }
    empty.lastUsed = typeof data.lastUsed === "string" ? data.lastUsed : null;
    return empty;
  } catch { return EMPTY(); }
}

export async function recordAiUsage(provider, success, file = FILE) {
  if (!["gemini", "groq"].includes(provider)) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const data = await getAiUsage(file);
  data.providers[provider].total++;
  data.providers[provider][success ? "success" : "failed"]++;
  data.lastUsed = new Date().toISOString();
  const temp = file + ".tmp";
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
