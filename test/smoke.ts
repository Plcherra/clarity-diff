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
import { ContextBudget, isDenied } from "../src/analysis/contextBudget";
import { renderFileTree } from "../src/util/fileTree";
import { CodeContext, CollectedDiff } from "../src/types";

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
    glossary: [{ term: "boolean", definition: "A yes/no switch." }],
  });
  const exp = parseExplanation(raw);
  assert.strictEqual(exp.intentMatch.status, "green");
  assert.strictEqual(exp.safety.risk, "low");
  assert.strictEqual(exp.nextSteps.length, 1);
  assert.strictEqual(exp.glossary.length, 1);
  assert.strictEqual(exp.glossary[0].term, "boolean");
});
test("drops malformed glossary entries and defaults to empty", () => {
  const exp = parseExplanation(
    '{"summary":"s","glossary":[{"term":"ok","definition":"fine"},{"term":"bad"},"nope"]}',
  );
  assert.strictEqual(exp.glossary.length, 1);
  assert.strictEqual(exp.glossary[0].definition, "fine");
  const noGloss = parseExplanation('{"summary":"s"}');
  assert.deepStrictEqual(noGloss.glossary, []);
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

console.log("contextBudget");
test("denies secrets, lockfiles, binaries, build output", () => {
  assert.ok(isDenied(".env"));
  assert.ok(isDenied("app/.env.local"));
  assert.ok(isDenied("package-lock.json"));
  assert.ok(isDenied("assets/logo.png"));
  assert.ok(isDenied("node_modules/left-pad/index.js"));
  assert.ok(isDenied("dist/extension.js"));
  assert.ok(!isDenied("src/app.ts"));
});
test("honors extra exclude globs", () => {
  assert.ok(isDenied("docs/secret.md", ["docs/*"]));
  assert.ok(!isDenied("src/app.ts", ["docs/*"]));
});
test("redacts, caps per file, and stops when budget is exhausted", () => {
  const budget = new ContextBudget(40);
  const a = budget.take("a.ts", "const token = 'xai-ABCDEFGHIJKLMNOP1234567890'", "changed");
  assert.ok(a);
  assert.ok(!a.content.includes("ABCDEFGHIJKLMNOP1234567890"));
  assert.strictEqual(budget.redactedAny, true);
  // Budget should now be near/at zero, so a large second file is refused.
  const b = budget.take("b.ts", "x".repeat(500), "changed");
  assert.ok(b === undefined || b.truncated);
  assert.ok(budget.truncatedAny);
});
test("skips denied files without consuming budget", () => {
  const budget = new ContextBudget(1000);
  const denied = budget.take(".env", "SECRET=1", "changed");
  assert.strictEqual(denied, undefined);
  assert.strictEqual(budget.used, 0);
});

console.log("fileTree");
test("renders directories before files, nested and indented", () => {
  const { tree } = renderFileTree(["src/app.ts", "src/util/log.ts", "README.md"]);
  assert.ok(tree.includes("src/"));
  assert.ok(tree.includes("  util/"));
  assert.ok(tree.includes("    log.ts"));
  assert.ok(tree.includes("README.md"));
  // Directory (src/) should be listed before the root file (README.md).
  assert.ok(tree.indexOf("src/") < tree.indexOf("README.md"));
});
test("truncates when over the entry cap", () => {
  const paths = Array.from({ length: 50 }, (_, i) => `f${i}.ts`);
  const { tree, truncated } = renderFileTree(paths, 10);
  assert.strictEqual(truncated, true);
  assert.ok(tree.includes("truncated"));
});

console.log("promptBuilder + context");
test("includes project map and changed-file contents when context is provided", () => {
  const diff: CollectedDiff = {
    diffText: "@@\n+x",
    files: [{ path: "src/app.ts", status: "modified" }],
    fingerprint: "f",
    truncated: false,
    redacted: false,
  };
  const context: CodeContext = {
    files: [{ path: "src/app.ts", content: "export const x = 1;", truncated: false, reason: "changed" }],
    projectMap: {
      tree: "src/\n  app.ts",
      manifests: [{ path: "package.json", content: '{"name":"demo"}', truncated: false, reason: "manifest" }],
    },
    totalBytes: 40,
    truncated: false,
    redacted: false,
    level: "changedFiles",
  };
  const messages = buildMessages("do a thing", diff, context);
  const user = messages[1].content;
  assert.ok(user.includes("PROJECT MAP"));
  assert.ok(user.includes("KEY FILES"));
  assert.ok(user.includes("CHANGED FILES (full current contents)"));
  assert.ok(user.includes("export const x = 1;"));
  assert.ok(user.includes('{"name":"demo"}'));
});
test("omits context sections when no context is provided", () => {
  const diff: CollectedDiff = {
    diffText: "d",
    files: [],
    fingerprint: "f",
    truncated: false,
    redacted: false,
  };
  const messages = buildMessages("x", diff);
  assert.ok(!messages[1].content.includes("PROJECT MAP"));
});

console.log(`\nAll ${passed} smoke checks passed.`);
