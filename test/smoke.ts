/**
 * Smoke test for the pure pipeline modules (no VS Code / no network).
 * Exercises the transforms the automatic Flow B relies on:
 *   redact -> truncate (safetyScanner) -> promptBuilder -> responseSchema.
 *
 * Run: npm run test:smoke
 */
import assert from "node:assert";
import { redactSecrets } from "../src/util/redact";
import { truncateToBytes } from "../src/util/truncate";
import { sanitizeDiff } from "../src/analysis/safetyScanner";
import { buildMessages } from "../src/llm/promptBuilder";
import { parseExplanation, SchemaValidationError } from "../src/llm/responseSchema";
import { CollectedDiff } from "../src/types";

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

console.log("redact");
test("masks a provider-prefixed API key", () => {
  const { text, redactedCount } = redactSecrets("const k = 'xai-ABCDEFGHIJKLMNOP1234567890'");
  assert.ok(!text.includes("ABCDEFGHIJKLMNOP1234567890"), "key should be masked");
  assert.ok(redactedCount >= 1);
});
test("masks a password assignment but keeps the key name", () => {
  const { text } = redactSecrets('password = "hunter2superSecret"');
  assert.ok(text.startsWith("password ="), "key name preserved");
  assert.ok(!text.includes("hunter2superSecret"), "value masked");
});
test("leaves ordinary code untouched", () => {
  const { redactedCount } = redactSecrets("function add(a, b) { return a + b; }");
  assert.strictEqual(redactedCount, 0);
});

console.log("truncate");
test("does not truncate small text", () => {
  const r = truncateToBytes("hello", 1000);
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.text, "hello");
});
test("truncates oversized text and marks it", () => {
  const big = "a\n".repeat(5000);
  const r = truncateToBytes(big, 200);
  assert.strictEqual(r.truncated, true);
  assert.ok(Buffer.byteLength(r.text, "utf8") <= 200);
  assert.ok(r.text.includes("truncated"));
});

console.log("safetyScanner");
test("redacts before truncating (secret near boundary cannot leak)", () => {
  const diff = "line before\nAKIAIOSFODNN7EXAMPLE\n" + "x\n".repeat(2000);
  const r = sanitizeDiff(diff, 300);
  assert.strictEqual(r.redacted, true);
  assert.strictEqual(r.truncated, true);
  assert.ok(!r.text.includes("AKIAIOSFODNN7EXAMPLE"));
});

console.log("promptBuilder");
test("includes intent, files, notices, and the diff", () => {
  const diff: CollectedDiff = {
    diffText: "@@ -1 +1 @@\n-old\n+new",
    files: [{ path: "src/app.ts", status: "modified" }],
    fingerprint: "abc",
    truncated: true,
    redacted: true,
  };
  const messages = buildMessages("add a dark mode toggle", diff);
  assert.strictEqual(messages[0].role, "system");
  const user = messages[1].content;
  assert.ok(user.includes("add a dark mode toggle"));
  assert.ok(user.includes("src/app.ts"));
  assert.ok(user.toLowerCase().includes("masked"));
  assert.ok(user.toLowerCase().includes("truncated"));
  assert.ok(user.includes("+new"));
});
test("handles empty intent gracefully", () => {
  const diff: CollectedDiff = {
    diffText: "diff",
    files: [],
    fingerprint: "x",
    truncated: false,
    redacted: false,
  };
  const messages = buildMessages("   ", diff);
  assert.ok(messages[1].content.includes("did not describe"));
});

console.log("responseSchema");
test("parses a clean JSON object", () => {
  const raw = JSON.stringify({
    summary: "Added a toggle.",
    intentMatch: { status: "green", reason: "Matches your request." },
    structureFit: "Fits the settings screen.",
    safety: { risk: "low", reasons: ["No data changes."] },
    nextSteps: ["Run the app."],
  });
  const exp = parseExplanation(raw);
  assert.strictEqual(exp.intentMatch.status, "green");
  assert.strictEqual(exp.safety.risk, "low");
  assert.strictEqual(exp.nextSteps.length, 1);
});
test("extracts JSON wrapped in prose/fences", () => {
  const raw = "Sure!\n```json\n{\"summary\":\"ok\"}\n```\nHope that helps.";
  const exp = parseExplanation(raw);
  assert.strictEqual(exp.summary, "ok");
});
test("fills safe defaults for missing/invalid fields", () => {
  const exp = parseExplanation('{"summary":"only summary"}');
  assert.strictEqual(exp.intentMatch.status, "unknown");
  assert.strictEqual(exp.safety.risk, "medium");
  assert.deepStrictEqual(exp.nextSteps, []);
});
test("throws on non-JSON so the caller can retry", () => {
  assert.throws(() => parseExplanation("no json here"), SchemaValidationError);
});

console.log(`\nAll ${passed} smoke checks passed.`);
