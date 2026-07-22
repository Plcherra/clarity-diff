# Clarity Diff — Project File Structure

```
clarity-diff/
├── .vscode/{launch.json, tasks.json}
├── package.json                 # manifest: contributes, activationEvents, commands, views
├── tsconfig.json
├── esbuild.js                   # bundler for host + webview
├── eslint.config.js
├── .prettierrc
├── .gitignore
├── .vscodeignore
├── README.md
├── src/
│   ├── extension.ts             # activate / deactivate
│   ├── commands/
│   │   ├── explainLatestChange.ts   # manual "Re-run" (only fallback)
│   │   ├── toggleAutoDetect.ts
│   │   └── manageApiKey.ts
│   ├── panel/
│   │   ├── ClarityViewProvider.ts   # WebviewViewProvider
│   │   └── messages.ts              # typed host<->webview message contracts
│   ├── git/
│   │   ├── gitDiffService.ts        # git API access + fallback
│   │   └── changeWatcher.ts         # auto-detect: onDidChange + debounce + de-dupe (PRIMARY)
│   ├── analysis/
│   │   ├── diffCollector.ts
│   │   └── safetyScanner.ts         # secret redaction + risk heuristics
│   ├── llm/
│   │   ├── grokClient.ts
│   │   ├── promptBuilder.ts
│   │   └── responseSchema.ts        # validation of model JSON
│   ├── config/settings.ts
│   ├── secrets/apiKeyStore.ts
│   ├── util/{logger.ts, truncate.ts, redact.ts}
│   └── types/index.ts
├── media/                        # webview assets (no framework needed for MVP)
│   ├── main.js
│   └── style.css
└── docs/
    ├── user-flows.md
    ├── architecture.md
    ├── file-structure.md
    └── coding-guidelines.md
```

## Module responsibilities

- **extension.ts** — wires activation: registers the view provider, commands, config,
  and starts the `changeWatcher`.
- **commands/** — thin orchestrators that call services; no business logic.
- **panel/** — the webview provider and the typed message contracts shared between host
  and webview (the only shared surface).
- **git/** — `gitDiffService` reads working-tree diffs; `changeWatcher` is the primary
  automatic trigger.
- **analysis/** — `diffCollector` assembles diff context; `safetyScanner` redacts
  secrets and computes size limits.
- **llm/** — `grokClient` calls the xAI API; `promptBuilder` composes the prompt;
  `responseSchema` validates model output.
- **config/**, **secrets/**, **util/**, **types/** — supporting infrastructure.
