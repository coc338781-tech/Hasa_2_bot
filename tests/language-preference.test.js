import test from "node:test";
import assert from "node:assert/strict";
import { setLanguagePreference } from "../lib/language-preference.js";

test("legacy language commands store the selected language", () => {
  const config = {};
  assert.equal(setLanguagePreference(config, "SI"), "SI");
  assert.equal(config.LANG, "SI");
  assert.equal(setLanguagePreference(config, "EN"), "EN");
  assert.equal(config.LANG, "EN");
});

test("language preference rejects unsupported values", () => {
  assert.throws(() => setLanguagePreference({}, "FR"), /SI or EN/);
});
