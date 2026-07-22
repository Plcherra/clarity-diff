---
name: clarity-diff-patterns
description: >-
  Reusable patterns for building Clarity Diff features — reading/summarizing git
  diffs, the automatic change watcher, Intent Match, Grok prompt building/calls,
  safety scanning and secret redaction, next steps, sidebar UI, error handling,
  and keeping the extension lightweight. Use when adding, fixing, or refactoring
  any Clarity Diff feature, or when working with git diffs, the change watcher,
  the Grok/xAI client, redaction/safety, the webview panel, or error handling in
  this extension.
---

# Clarity Diff — Reusable Skills & Patterns

Practical, repeatable patterns for building Clarity Diff features. Each skill describes
**when to use it**, the **pattern**, and **pitfalls**, and points at the real modules
that implement it. Use these instead of re-inventing approaches; extend them when adding
features (staying within the rules in [`CLARITY-DIFF-RULES.md`](CLARITY-DIFF-RULES.md)).

---

## Skill 1 — Read & summarize git diffs

**When:** any time you need to know "what did the AI just change?"

**Pattern**
1. Get the working-tree diff from [`gitDiffService`](src/git/gitDiffService.ts):
   - Resolve the built-in Git extension API
     (`vscode.extensions.getExtension('vscode.git').exports.getAPI(1)`) — typed locally,
     no `any`.
   - Use `repository.state` for the **changed-file list** (covers untracked files too).
   - Spawn `git diff HEAD` for the **unified diff text** (captures staged + unstaged
     tracked changes); fall back to `git diff` for a repo with no commits yet.
2. Assemble a `CollectedDiff` via [`diffCollector`](src/analysis/diffCollector.ts):
   redact, size-limit, and **fingerprint** (SHA-256 of the raw diff) for de-dupe.
3. For summarization, hand the diff to the LLM (Skill 4) — do **not** try to summarize
   diffs with hand-written heuristics; the model does the plain-English part.

**Pitfalls**
- Always fingerprint the **raw** (pre-redaction) diff so de-dupe is stable.
- An empty diff means "nothing to explain" — show the idle state, never call the model.
- Never assume a single repo; subscribe to `onDidOpenRepository` for multi-root cases.

---

## Skill 2 — Detect changes automatically (git watcher)

**When:** driving the primary automatic flow.

**Pattern** (see [`changeWatcher`](src/git/changeWatcher.ts) + `ClarityController.onSettle`)
1. **Primary signal:** subscribe to each repository's `state.onDidChange`.
2. **Fallback signal:** only if the Git API is unavailable, use a
   `createFileSystemWatcher`, ignoring `node_modules`, `.git`, `dist`, `build`, etc.
3. **Debounce/settle:** collapse the edit burst; wait for a quiet window
   (`clarityDiff.debounceMs`, ~1.5s) before firing a single settle event.
4. **De-dupe:** in the settle handler, skip if the new fingerprint equals the last one.
5. **Concurrency guard:** abort any in-flight Grok request when a newer settle arrives
   (`AbortController`), and ignore results from superseded runs.
6. **Gate:** only run when `autoDetect` is on, key + consent exist, it's a git repo, and
   the diff is non-empty and under the cap.

**Pitfalls**
- Read `debounceMs` lazily (via a getter) so setting changes take effect without restart.
- Don't watch `**/*` with the FS watcher as the primary signal — it's noisy and slow.

---

## Skill 3 — Intent Match check

**When:** deciding whether the change matches what the user asked for.

**Pattern**
1. Source the intent from the remembered value (`ClarityController.lastIntent` / the
   intent box). **Never invent it** (Rule 1.3).
2. Pass intent + diff to the model; ask for `intentMatch: { status, reason }` where
   `status` is `"green"` (matches) or `"red"` (different).
3. If intent is empty, instruct the model to judge on the change alone and say so in the
   reason; render as `"unknown"` when the model can't decide (see `FlagStatus`).
4. Render with an unmistakable visual (green/red/amber left-border card in
   [`media/main.js`](media/main.js)) plus the one-line reason.

**Pitfalls**
- Keep the reason to one plain sentence. No code identifiers unless unavoidable.
- Treat a missing/unclear status as `"unknown"`, not silently green.

---

## Skill 4 — Build prompts & call Grok

**When:** any LLM interaction.

**Pattern**
1. Compose messages in [`promptBuilder`](src/llm/promptBuilder.ts): a system message that
   pins the plain-English persona and the **exact JSON shape**, plus a user message with
   intent, changed-file list, notices (redacted/truncated), and the fenced diff.
2. Call xAI via [`grokClient`](src/llm/grokClient.ts):
   - Endpoint `https://api.x.ai/v1/chat/completions`, `Authorization: Bearer <key>`.
   - Request `response_format: { type: "json_object" }`, low temperature (~0.2).
   - Pass the `AbortSignal` from the concurrency guard.
3. Validate with [`responseSchema`](src/llm/responseSchema.ts). On malformed JSON, retry
   **once** with a "JSON only" reminder, then fail with a friendly message.

**Pitfalls**
- The model may wrap JSON in prose/fences — extract the first balanced `{...}` object
  before parsing.
- Map auth failures (401/403) to "check your API key," not a raw status dump.
- Never log the prompt if it could contain unredacted content.

---

## Skill 5 — Safety scanning & secret redaction

**When:** before **every** outbound payload, and when assessing risk.

**Pattern**
1. Redaction ([`redact`](src/util/redact.ts)): mask provider-prefixed keys, AWS IDs,
   bearer tokens, JWTs, PEM blocks, and `key/secret/token/password` assignments. For
   assignment-style matches, keep the key name and mask only the value.
2. Order matters: **redact, then truncate** ([`safetyScanner`](src/analysis/safetyScanner.ts),
   [`truncate`](src/util/truncate.ts)) so a secret near the cut boundary can't leak.
3. Risk flags: the model returns `safety: { risk: low|medium|high, reasons[] }`. Keep
   reasons concrete and plain ("This changes how users log in").
4. Surface a UI notice whenever `redacted` or `truncated` is true.

**Pitfalls**
- Redaction is heuristic — never treat it as perfect; combine with the consent gate.
- Truncate on a line boundary and append a visible truncation notice.

---

## Skill 6 — Generate clear next steps

**When:** closing every explanation, especially on red flags.

**Pattern**
1. Ask the model for `nextSteps: string[]` (1–3 items), each an **action the user can
   take** in plain language ("Ask the AI to keep the old login working," "Try running the
   app to check the settings page").
2. For red flags / high risk, make the first step the safest corrective action (e.g.,
   review or revert the specific file).
3. Render as an ordered list; keep items short and imperative.

**Pitfalls**
- No vague advice ("review the code"). Tie steps to the actual change.
- Cap at 3 to avoid overwhelming the user.

---

## Skill 7 — Structure the sidebar UI

**When:** rendering any panel state.

**Pattern** (see [`ClarityViewProvider`](src/panel/ClarityViewProvider.ts) +
[`messages.ts`](src/panel/messages.ts) + [`media/main.js`](media/main.js))
1. Model the UI as a **discriminated `PanelView`** union: `onboarding`, `consent`,
   `noRepo`, `idle`, `analyzing`, `result`, `error`. The host computes the view; the
   webview only renders it.
2. Communicate with typed messages (`HostToWebview` / `WebviewToHost`). Add new
   interactions by extending these unions on both sides.
3. Build DOM with `document.createElement` + `textContent`; use theme CSS variables
   (`--vscode-*`) so it matches light/dark.
4. Re-post the last view on `onDidChangeVisibility` so the panel rehydrates when reopened.

**Pitfalls**
- Never `innerHTML` model text. Never inline scripts without the nonce.
- Keep state authority in the host; the webview is a pure view.

---

## Skill 8 — Handle errors gracefully

**When:** anywhere something can fail (git, network, parsing, file open).

**Pattern**
1. Catch at the orchestration boundary (`ClarityController.runAnalysis`), classify the
   error, and post an `error` `PanelView` with a friendly message + a working Re-run
   control.
2. Log technical detail via [`logger`](src/util/logger.ts) only (redacted).
3. Distinguish **superseded** runs (`AbortError`) — silently ignore, don't show an error.
4. Fail soft: a bad analysis must never break the watcher or activation.

**Pitfalls**
- Don't surface stack traces or HTTP bodies to the user.
- Always leave the user a way forward (Re-run, fix key, init git).

---

## Skill 9 — Keep the extension lightweight & fast

**When:** always; revisit before adding dependencies or work on the hot path.

**Pattern**
1. **Debounce** to avoid mid-edit churn; **de-dupe** by fingerprint to skip redundant
   Grok calls; **supersede** stale requests.
2. Do heavy work lazily — resolve/activate the Git API on first use and cache it.
3. Keep the dependency footprint minimal (no UI framework in the webview; hand-rolled
   DOM). Bundle with esbuild; keep `dist/extension.js` small.
4. Respect `maxDiffBytes` and the token budget; never send unbounded payloads.
5. Prefer the Git API's in-memory state for file lists over spawning extra processes.

**Pitfalls**
- Avoid `**/*` file watching as a default; it scales poorly on big repos.
- Don't re-read settings in tight loops; read once per operation.
- Watch out for unbounded `maxBuffer` on spawned git — cap it (already 20 MB).
