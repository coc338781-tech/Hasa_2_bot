import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractPdfText, parseVCardInput, parseScheduleInput, parseSearchResults, createJpegPdf, commands } from "../plugins/advanced-tools.js";
import { appendCatalogToHelp, appendCatalogToList, getCategoryCommandLines } from "../lib/command-catalog.js";
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


test("PDF extractor reads simple text operators from a PDF stream", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length 29 >>\nstream\nBT (Hello from PDF) Tj ET\nendstream\nendobj\n%%EOF", "latin1");
  assert.match(extractPdfText(pdf), /Hello from PDF/);
});

test("image-to-PDF builder creates a valid PDF structure with correct stream length", () => {
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x11,0x08,0x00,0x01,0x00,0x01,0x03,0x01,0x11,0x00,0x02,0x11,0x00,0x03,0x11,0x00,0xff,0xd9]);
  const pdf = createJpegPdf(jpeg).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /\/Subtype \/Image/);
  const stream = pdf.match(/<< \/Length (\d+) >>\nstream\n(q .*?Q\n)endstream/);
  assert.ok(stream);
  assert.equal(Number(stream[1]), Buffer.byteLength(stream[2], "latin1"));
  assert.match(pdf, /startxref/);
});

test("all new features are automatically documented in their catalog categories", () => {
  const list = appendCatalogToList("BASE", commands, ".");
  const help = appendCatalogToHelp("BASE", commands, ".");
  for (const name of ["search", "tts", "pdf", "ocr", "topdf", "qr", "vcard", "aiusage", "schedule", "schedules", "cancelschedule"]) {
    assert.match(list, new RegExp("\\." + name + "\\b"));
    assert.match(help, new RegExp("\\." + name + "\\b"));
  }
  assert.ok(getCategoryCommandLines(commands, "5", ".").some(line => line.includes(".schedule ")));
  assert.ok(getCategoryCommandLines(commands, "8", ".").some(line => line.includes(".aiusage")));
});
