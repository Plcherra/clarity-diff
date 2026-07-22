import { redactSecrets } from "../util/redact";
import { truncateToBytes } from "../util/truncate";

export interface SanitizedDiff {
  /** Redacted and size-limited diff text, safe to send to the LLM. */
  text: string;
  truncated: boolean;
  redacted: boolean;
}

/**
 * Prepare raw diff text for transmission: mask likely secrets, then truncate to
 * the configured byte budget. Redaction always runs before truncation so that a
 * secret near the truncation boundary cannot leak.
 */
export function sanitizeDiff(rawDiff: string, maxBytes: number): SanitizedDiff {
  const { text: redactedText, redactedCount } = redactSecrets(rawDiff);
  const { text, truncated } = truncateToBytes(redactedText, maxBytes);
  return {
    text,
    truncated,
    redacted: redactedCount > 0,
  };
}
