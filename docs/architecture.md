# Clarity Diff — Technical Architecture

Confirmed decisions: **Grok (xAI) API only, user-supplied key**. Automatic-first
detection via a debounced git working-tree watcher, with a manual "Re-run" command as
the only fallback. Built on the standard VS Code Extension API (Cursor is
VS Code-compatible; there is no official "AI just changed" event, so we infer changes
from git working-tree activity).

## Runtime shape

- **Extension host (Node.js)**: activation, commands, git access, LLM calls, secret
  storage. All privileged work happens here.
- **Webview sidebar** (`WebviewViewProvider`): the UI. It is sandboxed and communicates
  with the host only via typed `postMessage`. No network access or secrets live in the
  webview.

## Automatic change detection (primary mechanism)

Since Cursor exposes no official "AI edited files" event, Clarity Diff infers it from
git working-tree activity, delivered by a dedicated **`changeWatcher`** service started
at activation:

- **Primary signal**: the built-in Git extension API `repository.state.onDidChange`,
  which fires whenever the working tree / index changes (covers AI edits, saves,
  stages).
- **Fallback signal**: a `vscode.workspace.createFileSystemWatcher` over workspace
  files for cases where the Git API is slow or unavailable.
- **Debounce/settle**: AI edits arrive as a burst; the watcher collapses them and waits
  for a quiet window (~1.5s, configurable) before treating it as "change finished,"
  preventing partial or repeated analysis mid-edit.
- **Change fingerprint + de-dupe**: hash the resulting diff; skip re-analysis if the
  diff is unchanged from the last run (avoids loops and redundant Grok calls).
- **Concurrency guard**: if a new settle occurs while a Grok request is in flight,
  cancel/supersede the stale request and analyze the newest diff.
- **Gating**: auto-runs only when `clarityDiff.autoDetect` is on (default), a key +
  consent exist, the repo is git-backed, and the diff is non-empty and under the size
  cap. If the workspace is not a git repo, the panel shows a clear
  "Clarity Diff needs a git repository to detect changes" state. The manual "Re-run"
  command is the only fallback trigger.

## Cursor / VS Code integration points

- **Activation**: `onStartupFinished` plus `onView:clarityDiff.panel` and command
  activation events (avoid `*`). The `changeWatcher` starts on activation so detection
  works even before the panel is first opened.
- **Sidebar**: contributed view container + `WebviewViewProvider` registered in
  `activate`.
- **Commands**: `explainLatestChange` (manual "Re-run" — the only fallback),
  `toggleAutoDetect`, `setApiKey`, `clearApiKey`.
- **Git**: use the built-in `vscode.git` extension API
  (`vscode.extensions.getExtension('vscode.git').exports.getAPI(1)`) for both change
  events and reading diffs; fall back to spawning `git diff` only if the API is
  unavailable.
- **Config**: `vscode.workspace.getConfiguration('clarityDiff')` for non-secret
  settings — `autoDetect` (default true), `debounceMs`, `model`, `maxDiffBytes`.
- **Secrets**: `context.secrets` (`SecretStorage`) for the Grok API key.

## Data flow (host)

`changeWatcher` (auto) / manual trigger -> `diffCollector` -> `safetyScanner`
(redact + size-limit) -> `promptBuilder` -> `grokClient` -> `responseSchema`
(validate) -> post result to webview (auto-rendered).

## LLM contract

- Single Grok chat-completions call requesting a **strict JSON object**:
  `{ summary, intentMatch: { status, reason }, structureFit, safety: { risk, reasons[] }, nextSteps[] }`.
- Validate/parse defensively; if the model returns malformed JSON, retry once with a
  "return valid JSON only" reminder, then surface a friendly error.

## Security & permissions

- API key only in `SecretStorage`; never written to settings, logs, or the webview.
- **Explicit user consent** before the first external request; a persistent notice that
  code is sent to xAI.
- **Secret redaction** before sending: scan diffs for common patterns (API keys,
  tokens, `.env` values, private keys) and mask them.
- Respect large/binary files; enforce a configurable max diff size and token budget with
  truncation.
- Webview **Content Security Policy**: nonce-based scripts, `default-src 'none'`, no
  remote resources; use `asWebviewUri` for local assets.
- No telemetry in the MVP (or strictly opt-in).
