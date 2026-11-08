import test from "node:test";
import assert from "node:assert/strict";
import { evaluateExpression, formatFancy, formatRuntime } from "../plugins/utilities.js";

test("calculator respects arithmetic precedence and parentheses", () => {
  assert.equal(evaluateExpression("2 + 3 * 4"), 14);
  assert.equal(evaluateExpression("(2 + 3) * 4"), 20);
  assert.equal(evaluateExpression("2^3^2"), 512);
  assert.equal(evaluateExpression("-2^2"), -4);
});

test("calculator supports safe math functions and constants", () => {
  assert.equal(evaluateExpression("sqrt(81) + abs(-2)"), 11);
  assert.equal(evaluateExpression("round(pi, 0)"), 3);
  assert.equal(evaluateExpression("pow(2, 5)"), 32);
});

test("calculator rejects code, unknown names, and division by zero", () => {
  assert.throws(() => evaluateExpression("process.exit()"));
  assert.throws(() => evaluateExpression("1 / 0"), /බිංදුවෙන්/);
  assert.throws(() => evaluateExpression("2 + unknown"));
  assert.throws(() => evaluateExpression("1;2"));
});

test("fancy formatter transforms Latin letters and digits only", () => {
  assert.equal(formatFancy("Hasa 2!"), "𝐇𝐚𝐬𝐚 𝟐!");
});

test("runtime formatter keeps days and seconds", () => {
  assert.equal(formatRuntime(90061), "1d 1h 1m 1s");
  assert.equal(formatRuntime(0), "0s");
});
