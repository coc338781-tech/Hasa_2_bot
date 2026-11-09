import test from "node:test";
import assert from "node:assert/strict";
import { appendCatalogToHelp, appendCatalogToList, getCategoryCommandLines, normalizeCommandCatalog } from "../lib/command-catalog.js";

const catalog = [
  { name: "newai", category: "2", usage: "newai <question>", description: "Ask the new AI assistant" },
  { name: "newmedia", category: "3", usage: "newmedia <url>", description: "Process a media link" }
];

test("new plugin commands are categorized for the numbered menu", () => {
  assert.deepEqual(getCategoryCommandLines(catalog, "2", "."), [".newai <question> — Ask the new AI assistant"]);
});
test("new plugin commands appear in the categorized command list", () => {
  const output = appendCatalogToList("BASE LIST", catalog, ".");
  assert.match(output, /AI ASSISTANT — NEW COMMANDS/);
  assert.match(output, /\\.newai <question> — Ask the new AI assistant/);
  assert.match(output, /MEDIA DOWNLOADS — NEW COMMANDS/);
  assert.match(output, /\\.newmedia <url> — Process a media link/);
});
test("new plugin commands appear in the detailed help guide", () => {
  const output = appendCatalogToHelp("BASE HELP", catalog, ".");
  assert.match(output, /අලුතින් එකතු කළ Commands/);
  assert.match(output, /\\.newai <question> — Ask the new AI assistant/);
  assert.match(output, /\\.newmedia <url> — Process a media link/);
});
test("invalid or incomplete command documentation is excluded", () => {
  assert.deepEqual(normalizeCommandCatalog([...catalog,
    { name: "bad", category: "99", usage: "bad", description: "Invalid category" },
    { name: "missing-help", category: "1", usage: "missing-help" }]), catalog);
});