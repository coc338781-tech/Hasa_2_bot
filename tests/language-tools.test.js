import test from "node:test";
import assert from "node:assert/strict";
import { lookupDictionary, parseTranslationInput, translateText } from "../plugins/language-tools.js";

test("translation input defaults to Sinhala and accepts target language", () => {
  assert.deepEqual(parseTranslationInput("Hello world"), { target: "si", text: "Hello world" });
  assert.deepEqual(parseTranslationInput("hello"), { target: "si", text: "hello" });
  assert.deepEqual(parseTranslationInput("ta Good morning"), { target: "ta", text: "Good morning" });
  assert.throws(() => parseTranslationInput(""), /භාවිතය/);
});

test("dictionary formats definitions and examples", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => [{ word: "hello", phonetic: "/həˈləʊ/", meanings: [
    { partOfSpeech: "interjection", definitions: [{ definition: "Used as a greeting.", example: "Hello there." }] }
  ] }] });
  const result = await lookupDictionary("hello", fakeFetch);
  assert.match(result, /DICTIONARY: hello/);
  assert.match(result, /Used as a greeting/);
  assert.match(result, /Hello there/);
});

test("dictionary rejects invalid input and missing words", async () => {
  await assert.rejects(() => lookupDictionary("hello; process.exit()"), /English/);
  await assert.rejects(() => lookupDictionary("unknown", async () => ({ ok: false, status: 404 })), /හමු වුණේ නැහැ/);
});

test("translation uses requested target language", async () => {
  let requestedUrl;
  const fakeFetch = async url => {
    requestedUrl = String(url);
    return { ok: true, json: async () => ({ responseStatus: 200, responseData: { translatedText: "ආයුබෝවන්" } }) };
  };
  const result = await translateText("si Hello", fakeFetch);
  assert.match(requestedUrl, /langpair=autodetect%7Csi/);
  assert.match(result, /ආයුබෝවන්/);
});

test("translation rejects oversized text and provider errors", async () => {
  await assert.rejects(() => translateText("x".repeat(501)), /500/);
  await assert.rejects(() => translateText("Hello", async () => ({ ok: true, json: async () => ({ responseStatus: 403 }) })), /පරිවර්තනය/);
});
