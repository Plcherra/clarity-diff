# Clarity Diff — User Flows

Clarity Diff explains AI code changes in plain English, automatically, inside Cursor.
The experience is **automatic-first**: after Cursor's AI finishes editing files, the
sidebar detects the change via a debounced git working-tree watcher and shows the
explanation, intent match, flags, and next steps — no copy-paste or manual selection.

The only fallback is a manual **"Re-run"** command. Selected-files mode and paste mode
are out of scope for the MVP.

## Flow A — First run / onboarding (set Grok key)

1. User installs and opens the Clarity Diff sidebar (activity-bar icon).
2. Panel detects no stored key and shows an onboarding card:
   "Add your Grok API key to get started" + link to the xAI console.
3. User pastes the key into an input; the extension stores it in VS Code
   `SecretStorage` (never in settings or logs).
4. A one-time consent notice explains that code/diffs are sent to xAI's API; the user
   must accept before any request is made.
5. Panel switches to the ready state.

## Flow B — Explain the latest AI change (PRIMARY, fully automatic)

This is the core, recommended experience. No button press, copy-paste, or manual
selection is needed.

1. User prompts Cursor's AI, which edits and saves files in the workspace.
2. Clarity Diff's **change watcher** (running since activation) observes git
   working-tree activity — it listens to the Git extension's
   `repository.state.onDidChange` (plus a `FileSystemWatcher` fallback) and
   **debounces** the burst of edits (~1.5s of quiet) to infer "the AI just finished a
   change."
3. On settle, the extension automatically computes the git working-tree diff
   (unstaged + staged) and begins analysis — the sidebar shows a live
   "Analyzing latest change…" state without any user action.
4. Intent for the Intent Match check is taken automatically from the last-known intent
   (remembered from the previous run / an always-visible intent box). The user can
   refine it, but analysis does not block on input.
5. The extension runs the safety scanner to redact obvious secrets, truncates to a
   token budget, builds the prompt, and calls Grok.
6. The sidebar **automatically renders** the structured result as soon as it returns:
   - Plain-English **summary** of what changed.
   - **Intent Match**: green "matches what you asked" or red "flag — did something
     different," with one-line reasoning.
   - **How it fits the project structure** (best-effort).
   - **What could break** (simple safety check).
   - **1–3 next steps** in plain language.
7. User can click a file chip to open that file at the changed lines.
8. A manual **"Re-run"** / `clarityDiff.explainLatestChange` command is the **only
   fallback** — a convenience to re-analyze the current working-tree diff on demand or
   when auto-detect is disabled. It is not required in the normal flow.
9. Auto-detection can be toggled via `clarityDiff.autoDetect` (default **on**); when
   off, analysis runs only via the manual "Re-run" command.

## Flow C — Acting on a red flag

1. When Intent Match is red or safety risk is high, the panel emphasizes the reasoning
   and shows concrete next steps (e.g., "revert file X," "ask the AI to Y").
2. The MVP provides guidance only (no auto-apply); "one-click apply" is a post-MVP
   phase.
