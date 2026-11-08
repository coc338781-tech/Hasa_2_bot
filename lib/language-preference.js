export function setLanguagePreference(config, language) {
  const value = String(language || "").toUpperCase();
  if (!["SI", "EN"].includes(value)) throw new Error("Language must be SI or EN.");
  config.LANG = value;
  return value;
}
