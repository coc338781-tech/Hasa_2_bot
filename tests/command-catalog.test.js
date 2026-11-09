import test from "node:test";
import assert from "node:assert/strict";
import { appendCatalogToHelp, appendCatalogToList, getCategoryCommandLines, normalizeCommandCatalog } from "../lib/command-catalog.js";

const catalog = [
  { name: "newai", category: "2", usage: "newai <question>", description: "Ask the new AI assistant" },
  { name: "newmedia", category: "3", usage: "newmedia <url>", description: "Process a media link" }
];

const baseList = [
  "│📜 AI ASSISTANT*",
  "*│►* .ai <question>",
  "╰────────",
  "│📜 MEDIA DOWNLOADS & STATUS SAVER*",
  "*│►* .dl <url>",
  "╰────────"
].join("\n");

const baseHelp = [
  "AI ASSISTANT 〕",
  "┃ .ai <question>",
  "┗━━━━━━━━",
  "MEDIA DOWNLOADS 〕",
  "┃ .dl <url>",
  "┗━━━━━━━━"
].join("\n");

test("new plugin commands are categorized for the numbered menu", () => {
  assert.deepEqual(getCategoryCommandLines(catalog, "2", "."), [".newai <question> — Ask the new AI assistant"]);
});
test("new plugin commands are inserted inside their existing command-list categories", () => {
  const output = appendCatalogToList(baseList, catalog, ".");
  assert.match(output, /AI ASSISTANT\*[\s\S]*\.newai <question> — Ask the new AI assistant[\s\S]*╰/);
  assert.match(output, /MEDIA DOWNLOADS & STATUS SAVER\*[\s\S]*\.newmedia <url> — Process a media link[\s\S]*╰/);
  assert.doesNotMatch(output, /NEW COMMANDS|COMMAND GUIDE/);
});
test("new plugin commands are inserted inside their existing detailed-help categories", () => {
  const output = appendCatalogToHelp(baseHelp, catalog, ".");
  assert.match(output, /AI ASSISTANT 〕[\s\S]*\.newai <question> — Ask the new AI assistant[\s\S]*┗/);
  assert.match(output, /MEDIA DOWNLOADS 〕[\s\S]*\.newmedia <url> — Process a media link[\s\S]*┗/);
  assert.doesNotMatch(output, /අලුතින් එකතු කළ Commands|NEW COMMANDS/);
});
test("invalid or incomplete command documentation is excluded", () => {
  assert.deepEqual(normalizeCommandCatalog([...catalog,
    { name: "bad", category: "99", usage: "bad", description: "Invalid category" },
    { name: "missing-help", category: "1", usage: "missing-help" }]), catalog);
});
