const CATEGORY_NAMES = {
  "1": "GENERAL & SYSTEM", "2": "AI ASSISTANT", "3": "MEDIA DOWNLOADS",
  "4": "GROUP MANAGEMENT", "5": "AUTOMATIONS", "6": "STICKER & MEDIA TOOLS",
  "7": "PRANK & FUN", "8": "OWNER CONTROL", "9": "SUBBOT MANAGER", "10": "UTILITY TOOLS"
};

const LIST_SECTIONS = {
  "1": "GENERAL & SYSTEM", "2": "AI ASSISTANT", "3": "MEDIA DOWNLOADS & STATUS SAVER",
  "4": "GROUP MANAGEMENT", "5": "AUTOMATIONS & AUTO REPLY", "6": "STICKER & MEDIA TOOLS",
  "7": "PRANK & FUN", "8": "OWNER CONTROL", "9": "SUBBOT MANAGER", "10": "UTILITY TOOLS"
};
const HELP_SECTIONS = {
  "1": "GENERAL & SYSTEM", "2": "AI ASSISTANT", "3": "MEDIA DOWNLOADS",
  "4": "GROUP COMMANDS", "5": "SETTINGS & AUTO FEATURES", "6": "STICKER & FUN",
  "7": "STICKER & FUN", "8": "OWNER & SUBBOT", "9": "OWNER & SUBBOT", "10": "UTILITY TOOLS"
};

export function normalizeCommandCatalog(entries = []) {
  if (!Array.isArray(entries)) return [];
  return entries.filter(item => item &&
    typeof item.name === "string" && /^[a-z0-9_-]+$/i.test(item.name) &&
    Object.hasOwn(CATEGORY_NAMES, String(item.category)) &&
    typeof item.usage === "string" && item.usage.trim() &&
    typeof item.description === "string" && item.description.trim()
  ).map(item => ({ name: item.name.toLowerCase(), category: String(item.category),
    usage: item.usage.trim().replace(/^\\.+/, ""), description: item.description.trim() }));
}

export function getCategoryCommandLines(entries, category, prefix = ".") {
  return normalizeCommandCatalog(entries).filter(item => item.category === String(category))
    .map(item => prefix + item.usage + " — " + item.description);
}

function insertIntoExistingSections(source, entries, prefix, sectionMap, mode) {
  const catalog = normalizeCommandCatalog(entries);
  if (!catalog.length) return source;
  const grouped = new Map();
  for (const item of catalog) {
    const title = sectionMap[item.category];
    if (!title) continue;
    if (!grouped.has(title)) grouped.set(title, []);
    grouped.get(title).push(item);
  }
  const lines = source.split("\n");
  for (const [title, items] of grouped) {
    const marker = mode === "help" ? "〕 " + title + " 〕" : "│📜 " + title + "*";
    const start = lines.findIndex(line => line.includes(marker));
    if (start < 0) continue;
    const close = lines.findIndex((line, index) => index > start &&
      (mode === "help" ? line.startsWith("┗") : line.startsWith("╰")));
    if (close < 0) continue;
    const additions = items.map(item => mode === "help"
      ? "┃ " + prefix + item.usage + " — " + item.description
      : "*│►* " + prefix + item.usage + " — " + item.description);
    lines.splice(close, 0, ...additions);
  }
  return lines.join("\n");
}

export function appendCatalogToList(list, entries, prefix = ".") {
  return insertIntoExistingSections(list, entries, prefix, LIST_SECTIONS, "list");
}

export function appendCatalogToHelp(help, entries, prefix = ".") {
  return insertIntoExistingSections(help, entries, prefix, HELP_SECTIONS, "help");
}
