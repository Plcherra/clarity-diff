# Clarity Diff — Coding Rules & Guidelines

## Language & structure

- TypeScript with `strict: true`; no `any` (use `unknown` + narrowing).
- Keep host and webview code strictly separated; they share only the types in
  `panel/messages.ts`.
- One responsibility per module; commands orchestrate, services do the work.

## Naming

- Files: `camelCase.ts` for modules, `PascalCase.ts` for classes/providers.
- Types/interfaces/classes: `PascalCase`; functions/vars: `camelCase`; constants:
  `UPPER_SNAKE_CASE`.
- Command IDs and settings namespaced under `clarityDiff.*`.

## Async & errors

- All I/O is `async/await`; never swallow errors silently.
- Wrap external calls (git, Grok) in typed try/catch; convert failures into
  user-friendly panel messages, log details via a single `logger` (OutputChannel).
- Validate all LLM output before rendering; treat malformed responses as recoverable
  errors.

## Security (non-negotiable)

- Never log or persist the API key or raw diffs containing secrets.
- Always run `safetyScanner`/`redact` before any outbound request.
- Enforce strict webview CSP with per-load nonce; sanitize any model text rendered as
  HTML (render as text, not raw HTML).
- Require explicit consent before the first outbound request.

## UX copy

- Plain, non-jargon language aimed at vibe coders; short sentences; explicit next steps.
- Green/red flags always paired with a one-line reason.

## Tooling

- ESLint + Prettier enforced; bundle with esbuild; debug via `.vscode/launch.json`
  (Extension Development Host).
