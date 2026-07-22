export interface RedactionResult {
  text: string;
  redactedCount: number;
}

const MASK = "«redacted»";

/**
 * Patterns for common secrets. These are heuristics — the goal is to avoid
 * leaking obvious credentials in diffs sent to the LLM, not perfect detection.
 */
const SECRET_PATTERNS: RegExp[] = [
  // Provider-prefixed keys (OpenAI, xAI, Anthropic, GitHub, Slack, Stripe, Google).
  /\b(?:sk|xai|pk|rk|ghp|gho|ghu|ghs|xox[baprs]|AIza)[-_A-Za-z0-9]{16,}\b/g,
  // AWS access key IDs.
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Bearer tokens in headers.
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g,
  // JWTs (three base64url segments).
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // PEM private key blocks.
  /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
  // key/secret/token/password assignments (env or code style).
  /((?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\s*[:=]\s*['"]?)([^\s'"]{8,})/gi,
];

/** Mask likely secrets in arbitrary text before it leaves the machine. */
export function redactSecrets(text: string): RedactionResult {
  let redactedCount = 0;
  let result = text;

  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (_match, prefix?: string) => {
      redactedCount += 1;
      // For assignment-style matches, keep the key name and mask only the value.
      if (typeof prefix === "string") {
        return `${prefix}${MASK}`;
      }
      return MASK;
    });
  }

  return { text: result, redactedCount };
}
