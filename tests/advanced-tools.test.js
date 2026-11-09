import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractPdfText, parseVCardInput, parseScheduleInput, parseSearchResults, createJpegPdf } from "../plugins/advanced-tools.js";
import { getAiUsage, recordAiUsage } from "../lib/ai-usage.js";

test("schedule parser validates delay, target and message", () => {
  const parsed = parseScheduleInput("10m 94771234567 | Hello there");
  assert.equal(parsed.number, "94771234567");
  assert.equal(parsed.text, "Hello there");
  assert.ok(parsed.dueAt > Date.now());
  assert.throws(() => parseScheduleInput("5s 94771234567 | hi"), /භාවිතය|කාලය/);
  assert.throws(() => parseScheduleInput("10m 123 | hi"), /භාවිතය/);
});

test("vCard parser creates a valid contact file and rejects invalid numbers", () => {
  const card = parseVCardInput("Hasa Test | +94771234567 | Hasa Traders");
  assert.match(card, /BEGIN:VCARD/);
  assert.match(card, /FN:Hasa Test/);
  assert.match(card, /TEL;TYPE=CELL:\+94771234567/);
  assert.match(card, /ORG:Hasa Traders/);
  assert.throws(() => parseVCardInput("Name | 123"), /වලංගු/);
});

test("web search parser extracts safe result links and snippets", () => {
  const html = '<div class="result results_links"><a class="result__a" href="https://example.com/a">Example &amp; One</a><a class="result__snippet">Useful result</a></div>';
  const results = parseSearchResults(html);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Example & One");
  assert.equal(results[0].url, "https://example.com/a");
});

test("PDF text extractor rejects non-PDF files", () => {
  assert.throws(() => extractPdfText(Buffer.from("not a pdf")), /PDF/);
});

test("AI usage tracker stores counts only and separates providers", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hasa-ai-usage-"));
  const file = path.join(dir, "usage.json");
  try {
    await recordAiUsage("gemini", true, file);
    await recordAiUsage("gemini", false, file);
    await recordAiUsage("groq", true, file);
    const stats = await getAiUsage(file);
    assert.deepEqual(stats.providers.gemini, { total: 2, success: 1, failed: 1 });
    assert.deepEqual(stats.providers.groq, { total: 1, success: 1, failed: 0 });
    assert.equal(typeof stats.lastUsed, "string");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
