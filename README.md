# Clarity Diff

Stop feeling lost in your own codebase. Clarity Diff is a Cursor / VS Code extension
that explains, in plain English, what the AI just changed — whether it matches what you
asked for, what could break, and exactly what to do next.

## How it works

Clarity Diff is **automatic-first**. After Cursor's AI edits your files, the sidebar
detects the change from your git working tree (debounced), sends the diff to Grok (xAI),
and shows:

- A plain-English summary of what changed
- An **Intent Match** check (green = matches what you asked, red = flag)
- How the change fits your project
- What could break (a simple safety check)
- 1–3 clear next steps

The only fallback is a manual **"Re-run"** command. Selected-files and paste modes are
out of scope for this MVP.

## Requirements

- A git-initialized workspace (changes are detected from the git working tree)
- A Grok (xAI) API key — get one at https://console.x.ai

## Getting started (development)

```bash
npm install
npm run build      # or: npm run watch
```

Press `F5` (Run Clarity Diff Extension) to launch an Extension Development Host.
Open the Clarity Diff panel from the activity bar, add your Grok API key, accept the
one-time consent notice, and start prompting the AI.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `clarityDiff.autoDetect` | `true` | Automatically explain changes when the working tree settles |
| `clarityDiff.debounceMs` | `1500` | Quiet window before analysis runs |
| `clarityDiff.model` | `grok-2-latest` | Grok model used for explanations |
| `clarityDiff.maxDiffBytes` | `60000` | Max diff size sent to the model (larger diffs are truncated) |

## Privacy & security

- Your API key is stored in VS Code `SecretStorage` and is never written to settings or
  logs.
- Obvious secrets in diffs are masked before anything is sent to xAI.
- Code is only sent after you accept the one-time consent notice.

## Documentation

See [`docs/`](docs/) for user flows, architecture, file structure, and coding
guidelines.
