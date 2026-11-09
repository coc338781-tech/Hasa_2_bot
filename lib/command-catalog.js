const CATEGORY_NAMES = {
  "1": "GENERAL & SYSTEM", "2": "AI ASSISTANT", "3": "MEDIA DOWNLOADS",
  "4": "GROUP MANAGEMENT", "5": "AUTOMATIONS", "6": "STICKER & MEDIA TOOLS",
  "7": "PRANK & FUN", "8": "OWNER CONTROL", "9": "SUBBOT MANAGER", "10": "UTILITY TOOLS"
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

function renderCatalogSections(entries, prefix, heading) {
  const catalog = normalizeCommandCatalog(entries);
  if (!catalog.length) return "";
  return Object.keys(CATEGORY_NAMES).map(category => {
    const items = catalog.filter(item => item.category === category);
    if (!items.length) return "";
    return ["", "╭──────────●●►", "*│📌 " + CATEGORY_NAMES[category] + " — " + heading + "*",
      ...items.map(item => "*│►* " + prefix + item.usage + " — " + item.description),
      "╰───────────●●►"].join("\\n");
  }).filter(Boolean).join("\\n");
}

export function appendCatalogToList(list, entries, prefix = ".") {
  const sections = renderCatalogSections(entries, prefix, "NEW COMMANDS");
  return sections ? list + "\\n" + sections : list;
}

export function appendCatalogToHelp(help, entries, prefix = ".") {
  const sections = renderCatalogSections(entries, prefix, "COMMAND GUIDE");
  return sections ? help + "\\n\\n*🧩 අලුතින් එකතු කළ Commands — කැටගරි අනුව*\\n" + sections +
    "\\n\\n📌 එක් එක් Command එකේ භාවිතය සහ විස්තර ඉහත දැක්වේ." : help;
}